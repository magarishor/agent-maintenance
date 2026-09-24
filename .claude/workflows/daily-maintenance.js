export const meta = {
  name: 'daily-maintenance',
  description: 'Daily maintenance for all scheduled websites - parallel batch processing with intelligent permission handling',
  phases: [
    { title: 'Setup', detail: 'Load sites and pre-approve permissions' },
    { title: 'Maintenance', detail: 'Process sites in parallel batches' },
    { title: 'Summary', detail: 'Send completion report' },
  ],
}

// ============================================================================
// STRICT STEP REQUIREMENTS - DO NOT DEVIATE
// ============================================================================
//
// Each site MUST follow this exact sequence - NO STEPS SKIPPED:
//
// 1. Health Check (initial)
// 2. Check for updates available
// 2a. Full backup (queued) → wait until the backup job finishes; skip updates if it fails
// 3. IF plugins available → ONE update-all batch (site updates each plugin with its own backup,
//    health check & auto-rollback) → monitor batch until no jobs pending/running
// 4. IF core available → wait for dashboard to release site lock → update core → monitor batch
// 5. Health Check (final) - MANDATORY
// 6. Check for external updates - MANDATORY (retry 3x if fails)
// 6.5. Detect manual/external updates - NEW: Track updates applied outside workflow
// 7. Sync sheet with data - MANDATORY (retry 3x if fails, even if no updates)
// 8. Send Google Chat notification - MANDATORY
//
// Between sites: Wait 60 seconds before next site
// After all sites: Send daily summary to Google Chat
//
// Batch monitoring: ALWAYS 2 minutes (120s) between checks - NEVER vary
// ============================================================================

// ============================================================================
// CONFIGURATION
// ============================================================================

const AGENT_CALL_INTERVAL = 60_000   // STRICT: 1 minute between agent calls
const BATCH_CHECK_INTERVAL = 120_000 // STRICT: 2 minutes in milliseconds (do not change)
const PARALLEL_BATCH_SIZE = 5        // Process 5 sites concurrently per batch
const BATCH_DELAY = 30_000           // 30 seconds between batches (API cooldown)
const MAX_BATCH_CHECKS = 5           // Max 5 checks = 10 minutes at 2-minute intervals
const MAX_RETRIES = 3                // Max retries for external updates & sheet sync
const REPORT_EMAIL = 'maintenance@smartsites.com'

// CONCURRENCY SAFETY (bulk-run fix)
// Sites within a batch run concurrently via Promise.all, but they all follow the
// SAME fixed sequence of fixed-length waits, so they stay in lock-step and fire
// shared-resource calls (batch-status polling, sheet sync) at the same instant.
// That simultaneous fan-out is what trips rate limits that a single manual site
// run never hits (e.g. check-batch-status-tool is limited to 1 call/15s per
// batch_id, and Google Sheets API write quotas are per-minute per project).
// Fix: (1) stagger each site's start within a batch so their timers drift apart,
// and (2) funnel the shared-resource calls through a cross-site rate limiter so
// even if timers do realign, actual calls stay spaced out.
const SITE_STAGGER_OFFSET = 20_000        // 20s stagger between site starts in a batch
const SHARED_RESOURCE_GAP = {
  'batch-status': 20_000,                 // > the confirmed 15s/batch_id API limit
  'sheet-sync': 15_000,                   // spread out Google Sheets API writes
}

// BACKUP & LOCK HANDLING
const MAX_PRE_BACKUP_ATTEMPTS = 2            // Full backup attempts before skipping updates
const PRE_BACKUP_RETRY_TIMEOUT = 180_000     // 3 minutes before backup retry
const MAX_RELEASE_CHECKS = 8                 // Max 8 checks = 16 minutes waiting for dashboard to release site lock
const LOCK_RETRIES = 3                       // Retries when an update is rejected with "already being processed"

// ============================================================================
// CROSS-SITE SHARED-RESOURCE RATE LIMITER
// ============================================================================
// Serializes calls to a named shared resource (e.g. 'batch-status', 'sheet-sync')
// across ALL concurrently-running site pipelines, enforcing a minimum gap between
// the end of one call and the start of the next. Implemented as a chained promise
// tail per resource key — deliberately avoids Date.now()/new Date() (unsafe for
// workflow resume), relying only on setTimeout-based waits.

const rateLimiterTails = {}

function withSharedResourceLimit(resourceKey, fn) {
  const gap = SHARED_RESOURCE_GAP[resourceKey] ?? 10_000
  const prevTail = rateLimiterTails[resourceKey] || Promise.resolve()

  const myTurn = prevTail.then(() => fn())

  // Next caller waits for this call to settle, then the cooldown gap, regardless
  // of whether this call succeeded or failed.
  rateLimiterTails[resourceKey] = myTurn
    .then(() => {}, () => {})
    .then(() => new Promise(resolve => setTimeout(resolve, gap)))

  return myTurn
}

// ============================================================================
// PHASE 1: LOAD TODAY'S SITES
// ============================================================================

phase('Setup')

log('📅 Loading today\'s maintenance sites from Google Sheet...')

// Create log directory with timestamp (passed from args or hardcoded safe string)
// Cannot use new Date() in workflows - use safe string instead
const logDir = `log/maintenance_logs`

const siteDataResult = await agent(
  `You are a sites loader. Your job is to fetch the list of sites scheduled for maintenance today.

1. Run: python get_today_sites.py
2. Parse the JSON output carefully
3. Return structured data with day, date, total_sites, and sites array

Each site must have: url, site_id, row, test_pass, glog_sheet

Return the clean validated JSON object.`,
  {
    label: 'fetch-daily-sites',
    phase: 'Setup',
    schema: {
      type: 'object',
      properties: {
        day: { type: 'string' },
        date: { type: 'string' },
        total_sites: { type: 'number' },
        sites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'number' },
              url: { type: 'string' },
              site_id: { type: 'string' },
              test_pass: { type: 'string' },
              glog_sheet: { type: 'string' }
            },
            required: ['url', 'site_id']
          }
        }
      },
      required: ['day', 'date', 'total_sites', 'sites']
    }
  }
)

if (!siteDataResult || siteDataResult.total_sites === 0) {
  log('❌ No sites found for today. Exiting.')
  return { success: false, message: 'No sites for today' }
}

const { day, total_sites, sites } = siteDataResult
log(`✅ Found ${total_sites} sites for ${day}`)

// ============================================================================
// PRE-APPROVE PERMISSIONS FOR SESSION (PHASE 1 ENHANCEMENT)
// ============================================================================

log('🔐 Requesting session-level permissions for all MCP tools...')

const permissionApproval = await agent(
  `Pre-approve MCP tool access for this maintenance workflow session.

Request permission to use these tools for all upcoming agent calls:
- smartsites-maintenance: health-check-tool, check-updates-tool, update-all-plugins-tool, update-core-tool, check-batch-status-tool, check-external-updates-tool, sync-sheets-tool, and others
- Google Sheets API: sync results to maintenance tracking sheet
- Google Chat API: send maintenance notifications and summaries

This is a one-time approval for the entire workflow session.
Once approved, all subsequent site maintenance steps will proceed without additional permission prompts.

Return: {approved: true, message: "Permissions granted for session"} after permissions are confirmed.`,
  {
    label: 'pre-approve-session-permissions',
    phase: 'Setup',
    schema: {
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        message: { type: 'string' }
      },
      required: ['approved']
    }
  }
)

if (!permissionApproval?.approved) {
  log('❌ Permission approval failed. Exiting.')
  return { success: false, message: 'Session permissions required to proceed' }
}

log('✅ Session permissions approved - workflow will proceed without additional prompts')

const dayResults = {
  day,
  date: siteDataResult.date,
  total_sites,
  completed: 0,
  failed: 0,
  sites_results: [],
}

// Helper function to write site logs - minimal to avoid Date issues
async function writeSiteLog(siteData) {
  const filename = `site_${siteData.site_id}.json`
  const fullPath = `log/maintenance_logs/${filename}`

  await agent(
    `Write JSON file to: ${fullPath}

Content: ${JSON.stringify(siteData)}

Use Python:
import os, json
os.makedirs('log/maintenance_logs', exist_ok=True)
with open('${fullPath}', 'w') as f:
    json.dump(${JSON.stringify(siteData)}, f)

Return {success: true, path: '${fullPath}'}`,
    {
      label: `write-log-${siteData.site_id}`,
      phase: 'Maintenance',
      agentType: 'general-purpose'
    }
  )
}

// ============================================================================
// MAINTENANCE API HELPERS
// ============================================================================
//
// Why these exist (root causes of past bulk-run failures):
// - Updates/backups are ASYNC: tools return a queued batch_id, not a result.
//   We must poll the batch on the site until it has no pending/running jobs.
// - After a batch finishes on the site, the Pegasus dashboard keeps the site
//   LOCKED until it marks the batch "batch_processed" (can take 5-10 min).
//   Any update sent during that window is rejected with
//   "Another update(...) is already being processed".
// - Health checks must return a real boolean, otherwise an undefined value
//   was treated as a failure and triggered a rollback of a good update.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const isLockError = text => /already being processed/i.test(String(text || ''))

const HEALTH_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    failed_checks: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' }
  },
  required: ['passed', 'message']
}

const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    pending: { type: 'number' },
    running: { type: 'number' },
    completed: { type: 'number' },
    failed: { type: 'number' },
    cancelled: { type: 'number' },
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          job_type: { type: 'string' },
          plugin_slug: { type: ['string', 'null'] },
          status: { type: 'string' },
          error_message: { type: ['string', 'null'] },
          old_version: { type: ['string', 'null'] },
          new_version: { type: ['string', 'null'] },
          backup_id: { type: ['string', 'null'] },
          rolled_back: { type: 'boolean' }
        },
        required: ['job_type', 'status']
      }
    }
  },
  required: ['pending', 'running', 'completed', 'failed', 'cancelled', 'jobs']
}

async function runHealthCheck(site, label, context = '') {
  const result = await agent(
    `${context}Call smartsites-maintenance:health-check-tool with id="${site.site_id}".
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__health-check-tool". Do NOT invent a result.

Set passed=true ONLY if the tool reports "Overall: PASSED" (all_passed=true). Put the names of any failed checks in failed_checks.`,
    { label, phase: 'Maintenance', schema: HEALTH_SCHEMA }
  )
  return { status: result?.passed ? 'passed' : 'failed', details: result }
}

// Poll a batch directly on the site until no jobs are pending/running.
async function waitForSiteBatch(site, batchId, labelPrefix) {
  let last = null
  for (let check = 1; check <= MAX_BATCH_CHECKS; check++) {
    await sleep(BATCH_CHECK_INTERVAL)
    last = await withSharedResourceLimit('batch-status', () => agent(
      `MUST CALL: smartsites-maintenance:check-batch-status-tool
Parameters: id="${site.site_id}", batch_id="${batchId}", check_directly_on_site=true
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__check-batch-status-tool". Do NOT invent a result.

Copy the counts from the response "summary". For each job copy job_type, plugin_slug, status, error_message,
and from job.result: old_version, new_version, backup_id, and rolled_back (job.result.health_checks.rolled_back, default false).`,
      { label: `${labelPrefix}-check${check}`, phase: 'Maintenance', schema: BATCH_SCHEMA }
    ))
    log(`  📊 [${site.site_id}] ${labelPrefix} #${check}: ✓${last?.completed ?? 0} ✗${last?.failed ?? 0} ⊘${last?.cancelled ?? 0} (pending ${last?.pending ?? '?'}, running ${last?.running ?? '?'})`)
    if (last && last.pending === 0 && last.running === 0) {
      return { done: true, ...last }
    }
  }
  return { done: false, timeout: true, ...(last || {}) }
}

// Wait until the Pegasus dashboard marks the batch processed (releases the site lock).
async function waitForDashboardRelease(site, batchId, labelPrefix) {
  for (let check = 1; check <= MAX_RELEASE_CHECKS; check++) {
    const status = await withSharedResourceLimit('batch-status', () => agent(
      `MUST CALL: smartsites-maintenance:check-batch-status-tool
Parameters: id="${site.site_id}", batch_id="${batchId}", check_directly_on_site=false
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__check-batch-status-tool". Do NOT invent a result.

Return the "event" field of the returned log record exactly (e.g. "batch_queued" or "batch_processed").`,
      {
        label: `${labelPrefix}-release${check}`,
        phase: 'Maintenance',
        schema: { type: 'object', properties: { event: { type: 'string' } }, required: ['event'] }
      }
    ))
    if (/processed/i.test(status?.event || '')) {
      log(`  🔓 [${site.site_id}] Dashboard released site after ${labelPrefix}`)
      return true
    }
    log(`  🔒 [${site.site_id}] Site still locked (${status?.event || 'unknown'}) - waiting ${BATCH_CHECK_INTERVAL / 1000}s...`)
    await sleep(BATCH_CHECK_INTERVAL)
  }
  return false
}

// Queue an async job; if the dashboard says the site is locked, wait and retry.
// queueFn must return {batch_id, error}.
async function queueWithLockRetry(site, labelPrefix, queueFn) {
  let queued = null
  for (let attempt = 1; attempt <= LOCK_RETRIES; attempt++) {
    queued = await queueFn(attempt)
    if (queued?.batch_id) return queued
    if (!isLockError(queued?.error) || attempt === LOCK_RETRIES) return queued
    log(`  🔒 [${site.site_id}] ${labelPrefix}: site locked by another update - retrying in ${BATCH_CHECK_INTERVAL / 1000}s (attempt ${attempt}/${LOCK_RETRIES})`)
    await sleep(BATCH_CHECK_INTERVAL)
  }
  return queued
}

const QUEUE_SCHEMA_PROPS = {
  batch_id: { type: 'string' },
  error: { type: 'string' }
}


// ============================================================================
// PHASE 2: PROCESS SITES IN PARALLEL BATCHES
// ============================================================================

phase('Maintenance')

// Helper function to process a single site (runs in parallel with others in batch)
async function processSiteSequence(site, siteNum, total_sites) {
  log(`🔧 [${siteNum}/${total_sites}] Processing: ${site.url}`)

  const siteResult = {
    url: site.url,
    site_id: site.site_id,
    row: site.row,
    status: 'pending',
    steps: {},
    batch_jobs: [],
    step_log: [], // Detailed step log with status
  }

  try {
    // ========================================================================
    // STEP 1: Initial Health Check
    // ========================================================================

    log(`  1️⃣ [${siteNum}] Running health check...`)

    const healthCheck1 = await runHealthCheck(site, `health-check-initial-${siteNum}`)
    const initialHealthStatus = healthCheck1.status
    siteResult.steps.initial_health = healthCheck1
    siteResult.step_log.push({
      step_number: 1,
      step_name: 'Health Check (Initial)',
      status: initialHealthStatus === 'passed' ? 'success' : 'failed',
      details: healthCheck1.details
    })
    log(`  ✅ [${siteNum}] Health: ${initialHealthStatus}`)

    // Wait 1 minute before next agent call
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before next step...`)
    await sleep(AGENT_CALL_INTERVAL)

    // ========================================================================
    // STEP 2a: Create Fresh Full Backup (queued job - wait for it to finish)
    // ========================================================================

    log(`  2️⃣a [${siteNum}] Creating fresh backup before updates...`)

    let preBackup = { success: false, backup_id: null, error: null }
    let backupAttempt = 0

    while (!preBackup.success && backupAttempt < MAX_PRE_BACKUP_ATTEMPTS) {
      backupAttempt++
      log(`  🔄 [${siteNum}] Backup attempt ${backupAttempt}/${MAX_PRE_BACKUP_ATTEMPTS}...`)

      const backupQueued = await agent(
        `MUST CALL: smartsites-maintenance:create-backup-tool
Parameters: id="${site.site_id}", backup_type="full"
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__create-backup-tool". Do NOT invent a result.

The backup is queued asynchronously. Return the batch_id from the response (e.g. "batch_abc123").
If the tool returns an error, set batch_id to "" and error to the exact error message.`,
        {
          label: `pre-backup-${siteNum}-attempt${backupAttempt}`,
          phase: 'Maintenance',
          schema: { type: 'object', properties: QUEUE_SCHEMA_PROPS, required: ['batch_id'] }
        }
      )

      if (backupQueued?.batch_id) {
        const backupBatch = await waitForSiteBatch(site, backupQueued.batch_id, `pre-backup-${siteNum}`)
        const backupJob = (backupBatch.jobs || []).find(j => j.job_type === 'backup')
        if (backupBatch.done && backupJob?.status === 'completed' && backupJob?.backup_id) {
          preBackup = { success: true, backup_id: backupJob.backup_id, batch_id: backupQueued.batch_id }
          log(`  ✅ [${siteNum}] Fresh backup ready: ${backupJob.backup_id}`)
          break
        }
        preBackup.error = backupBatch.timeout ? 'Backup did not finish in time' : (backupJob?.error_message || 'Backup job failed')
      } else {
        preBackup.error = backupQueued?.error || 'Backup could not be queued'
      }

      if (backupAttempt < MAX_PRE_BACKUP_ATTEMPTS) {
        log(`  ⚠️  [${siteNum}] Backup attempt ${backupAttempt} failed (${preBackup.error}) - retrying in ${PRE_BACKUP_RETRY_TIMEOUT / 1000}s...`)
        await sleep(PRE_BACKUP_RETRY_TIMEOUT)
      }
    }

    siteResult.steps.pre_backup = { ...preBackup, attempts: backupAttempt }

    if (!preBackup.success) {
      log(`  ❌ [${siteNum}] Pre-backup FAILED after ${backupAttempt} attempts - SKIPPING ALL UPDATES (no safe backup)`)
      siteResult.step_log.push({
        step_number: '2a',
        step_name: 'Pre-Backup Creation',
        status: 'failed',
        details: preBackup,
        attempts: backupAttempt,
        reason: 'Backup creation timeout/failed - skipping plugin/core updates for safety'
      })
      siteResult.status = 'completed_with_warning'
      log(`  💾 [${siteNum}] Saving site log (backup failed)...`)
      await agent(
        `Write file: log/maintenance_logs/site_${siteResult.site_id}.json
Content: ${JSON.stringify(siteResult)}
Use Python to write. Return {success: true}.`,
        {
          label: `log-backup-fail-${siteNum}`,
          phase: 'Maintenance'
        }
      )
      return siteResult
    }

    siteResult.step_log.push({
      step_number: '2a',
      step_name: 'Pre-Backup Creation',
      status: 'success',
      details: { backup_id: preBackup.backup_id },
      attempts: backupAttempt
    })

    // Wait 1 minute before next step
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before next step...`)
    await sleep(AGENT_CALL_INTERVAL)

    // ========================================================================
    // STEP 3: Check for Available Updates
    // ========================================================================

    log(`  3️⃣ [${siteNum}] Checking for available updates...`)

    const updateCheck = await agent(
      `MUST CALL: smartsites-maintenance:check-updates-tool
Parameters: id="${site.site_id}"
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__check-updates-tool". Do NOT invent a result.

Return every plugin in data.plugins as {slug, name, current_version, new_version, can_update}.
core_available is true only if data.core has a new_version; core_version is that new_version (or "N/A").`,
      {
        label: `check-updates-${siteNum}`,
        phase: 'Maintenance',
        schema: {
          type: 'object',
          properties: {
            plugin_list: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  name: { type: 'string' },
                  current_version: { type: 'string' },
                  new_version: { type: 'string' },
                  can_update: { type: 'boolean' }
                },
                required: ['slug', 'can_update']
              }
            },
            core_available: { type: 'boolean' },
            core_version: { type: 'string' }
          },
          required: ['plugin_list', 'core_available', 'core_version']
        }
      }
    )

    const pluginList = updateCheck?.plugin_list || []
    const updatablePlugins = pluginList.filter(p => p.can_update)
    const blockedPlugins = pluginList.filter(p => !p.can_update)
    const pluginsAvailable = updatablePlugins.length
    const coreAvailable = updateCheck?.core_available ?? false
    const coreVersion = updateCheck?.core_version || 'N/A'

    siteResult.steps.update_check = {
      plugins_available: pluginsAvailable,
      plugins_blocked: blockedPlugins.map(p => p.name || p.slug),
      core_available: coreAvailable,
      core_version: coreVersion,
      details: updateCheck,
    }
    siteResult.step_log.push({
      step_number: 2,
      step_name: 'Check for Updates',
      status: 'success',
      details: { plugins_available: pluginsAvailable, plugins_blocked: blockedPlugins.length, core_available: coreAvailable, core_version: coreVersion }
    })
    log(`  ✅ [${siteNum}] Found ${pluginsAvailable} plugin updates (${blockedPlugins.length} blocked), Core: ${coreAvailable ? coreVersion : 'No'}`)

    // ========================================================================
    // STEP 4: Update Plugins (one batch - the site updates each plugin in turn
    //         with its own backup, health check and automatic rollback)
    // ========================================================================

    let pluginBatchId = null

    if (pluginsAvailable > 0) {
      log(`  ⏱️  [${siteNum}] Waiting 1 minute before plugin update step...`)
      await sleep(AGENT_CALL_INTERVAL)

      log(`  4️⃣ [${siteNum}] Updating ${pluginsAvailable} plugins: ${updatablePlugins.map(p => p.slug).join(', ')}`)

      const pluginQueued = await queueWithLockRetry(site, `plugin-update-${siteNum}`, attempt => agent(
        `MUST CALL: smartsites-maintenance:update-all-plugins-tool
Parameters: id="${site.site_id}", create_backup=true, run_health_checks=true, security_only=false
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__update-all-plugins-tool". Do NOT invent a result.

Return batch_id from the response. If the tool returns an error, set batch_id to "" and error to the exact error message.`,
        {
          label: `update-plugins-${siteNum}-attempt${attempt}`,
          phase: 'Maintenance',
          model: 'sonnet',
          schema: { type: 'object', properties: QUEUE_SCHEMA_PROPS, required: ['batch_id'] }
        }
      ))

      pluginBatchId = pluginQueued?.batch_id || null
      siteResult.steps.plugin_update_request = { batch_id: pluginBatchId, error: pluginQueued?.error || null }

      if (!pluginBatchId) {
        log(`  ❌ [${siteNum}] Plugin update could not be queued: ${pluginQueued?.error}`)
        siteResult.batch_jobs.push({ type: 'plugin_update', batch_id: null, final_status: 'failed', details: pluginQueued })
      } else {
        log(`  📦 [${siteNum}] Plugin batch queued: ${pluginBatchId}`)
        const pluginBatch = await waitForSiteBatch(site, pluginBatchId, `plugins-${siteNum}`)
        const pluginFinalStatus = pluginBatch.timeout ? 'timeout'
          : (pluginBatch.failed > 0 || pluginBatch.cancelled > 0) ? 'failed' : 'completed'
        const rolledBack = (pluginBatch.jobs || []).filter(j => j.rolled_back).map(j => j.plugin_slug)

        siteResult.batch_jobs.push({
          type: 'plugin_update',
          batch_id: pluginBatchId,
          final_status: pluginFinalStatus,
          rolled_back: rolledBack,
          details: pluginBatch,
        })
        log(`  ${pluginFinalStatus === 'completed' ? '✅' : '❌'} [${siteNum}] Plugins ${pluginFinalStatus}: ✓${pluginBatch.completed ?? 0} ✗${pluginBatch.failed ?? 0} ⊘${pluginBatch.cancelled ?? 0}${rolledBack.length ? ` (rolled back: ${rolledBack.join(', ')})` : ''}`)
      }
    } else {
      log(`  ⏭️  [${siteNum}] No plugin updates available, skipping...`)
    }

    // ========================================================================
    // STEP 5: Update WordPress Core (ONLY IF UPDATES AVAILABLE)
    // ========================================================================

    if (coreAvailable) {
      // The dashboard keeps the site locked until it marks the plugin batch
      // processed - sending core before that is rejected.
      if (pluginBatchId) {
        log(`  🔒 [${siteNum}] Waiting for dashboard to release site after plugin batch...`)
        const released = await waitForDashboardRelease(site, pluginBatchId, `plugins-${siteNum}`)
        if (!released) log(`  ⚠️  [${siteNum}] Site still locked after ${MAX_RELEASE_CHECKS} checks - core update will retry on lock`)
      } else {
        log(`  ⏱️  [${siteNum}] Waiting 1 minute before core update step...`)
        await sleep(AGENT_CALL_INTERVAL)
      }

      log(`  5️⃣ [${siteNum}] Updating WordPress core to ${coreVersion}...`)

      const coreQueued = await queueWithLockRetry(site, `core-update-${siteNum}`, attempt => agent(
        `MUST CALL: smartsites-maintenance:update-core-tool
Parameters: id="${site.site_id}", version="${coreVersion}", create_backup=true, run_health_checks=true
If the tool is not visible, load it with ToolSearch "select:mcp__smartsites-maintenance__update-core-tool". Do NOT invent a result.

NOTE: this tool often reports success:false with reason "Job queued — poll ..." - that means the update WAS queued.
In that case return batch_id from data.batch_id (or log.properties.response.batch_id).
Only if the tool returns a real error (no batch_id anywhere), set batch_id to "" and error to the exact error message.`,
        {
          label: `update-core-${siteNum}-attempt${attempt}`,
          phase: 'Maintenance',
          model: 'sonnet',
          schema: { type: 'object', properties: QUEUE_SCHEMA_PROPS, required: ['batch_id'] }
        }
      ))

      const coreBatchId = coreQueued?.batch_id || null
      siteResult.steps.core_update_request = {
        batch_id: coreBatchId,
        target_version: coreVersion,
        error: coreQueued?.error || null,
      }

      if (!coreBatchId) {
        log(`  ❌ [${siteNum}] Core update could not be queued: ${coreQueued?.error}`)
        siteResult.batch_jobs.push({ type: 'core_update', batch_id: null, final_status: 'failed', details: coreQueued })
      } else {
        log(`  📦 [${siteNum}] Core batch queued: ${coreBatchId}`)
        const coreBatch = await waitForSiteBatch(site, coreBatchId, `core-${siteNum}`)
        const coreJob = (coreBatch.jobs || []).find(j => j.job_type === 'update_core')
        const coreFinalStatus = coreBatch.timeout ? 'timeout'
          : coreJob?.status === 'completed' ? 'completed' : 'failed'

        siteResult.batch_jobs.push({
          type: 'core_update',
          batch_id: coreBatchId,
          final_status: coreFinalStatus,
          details: coreBatch,
        })
        log(`  ${coreFinalStatus === 'completed' ? '✅' : '❌'} [${siteNum}] Core ${coreFinalStatus}${coreJob?.error_message ? `: ${coreJob.error_message}` : ''}${coreJob?.new_version ? ` (${coreJob.old_version} → ${coreJob.new_version})` : ''}`)
      }
    } else {
      log(`  ⏭️  [${siteNum}] No WordPress core updates available, skipping...`)
    }

    // ========================================================================
    // STEP 6: Final Health Check
    // ========================================================================

    // Wait 1 minute before final health check
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before final health check...`)
    await sleep(AGENT_CALL_INTERVAL)

    log(`  6️⃣ [${siteNum}] Running final health check...`)

    const healthCheck2 = await runHealthCheck(site, `health-check-final-${siteNum}`)
    const finalHealthStatus = healthCheck2.status
    siteResult.steps.final_health = healthCheck2
    siteResult.step_log.push({
      step_number: 5,
      step_name: 'Health Check (Final)',
      status: finalHealthStatus === 'passed' ? 'success' : 'failed',
      details: healthCheck2.details
    })
    log(`  ✅ [${siteNum}] Final Health: ${finalHealthStatus}`)

    // ========================================================================
    // STEP 7: Check External Updates (MANDATORY - DO NOT SKIP)
    // ========================================================================

    // Wait 1 minute before external check
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before external updates check...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  7️⃣ [${siteNum}] Checking for external updates...`)
    let externalUpdatesResult = null
    let externalRetryCount = 0
    let externalSuccess = false

    // STRICT: Retry until success or max retries
    while (externalUpdatesResult === null && externalRetryCount < MAX_RETRIES) {
      try {
        externalRetryCount++
        const externalUpdates = await agent(
          `Previous steps: Final health check = ${finalHealthStatus}; All site updates completed.
Attempt ${externalRetryCount} of ${MAX_RETRIES}.

MUST CALL: smartsites-maintenance:check-external-updates-tool
Parameters: id="${site.site_id}"

If this tool is not immediately visible, use ToolSearch with query "select:smartsites-maintenance:check-external-updates-tool" to load it first, then call it. Do NOT compose a fake response.
Return the exact response from the tool with found_external (boolean), updates (array), message.`,
          {
            label: `check-external-${siteNum}-attempt${externalRetryCount}`,
            phase: 'Maintenance',
          }
        )

        if (externalUpdates) {
          externalUpdatesResult = externalUpdates
          siteResult.steps.external_updates = {
            found: externalUpdates?.found_external || false,
            details: externalUpdates,
          }
          externalSuccess = true
          log(`  ✅ [${siteNum}] External updates checked`)
        }
      } catch (e) {
        log(`  ⚠️  [${siteNum}] External updates check failed (attempt ${externalRetryCount}/${MAX_RETRIES})`)
        if (externalRetryCount < MAX_RETRIES) {
          // Wait 1 minute before retry
          log(`  ⏱️  [${siteNum}] Waiting 1 minute before external updates retry...`)
          await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))
        }
        if (externalRetryCount >= MAX_RETRIES) {
          log(`  ❌ [${siteNum}] CRITICAL: External updates check FAILED after ${MAX_RETRIES} retries - STEP NOT SKIPPED`)
          siteResult.steps.external_updates = { found: false, details: { error: e.message, retries_exhausted: true } }
        }
      }
    }

    siteResult.step_log.push({
      step_number: 6,
      step_name: 'Check External Updates',
      status: externalSuccess ? 'success' : 'failed_with_retries',
      details: siteResult.steps.external_updates,
      attempts: externalRetryCount
    })

    // ========================================================================
    // STEP 6.5: Detect Manual/External Updates (NEW - Track updates applied outside workflow)
    // ========================================================================

    log(`  6️⃣.5️⃣ [${siteNum}] Detecting manually applied updates...`)

    const manualUpdatesResult = await agent(
      `Check for manually applied plugin updates for site id="${site.site_id}".

Previous workflow updates: Plugins=${siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.final_status || 'none'}; Core=${siteResult.batch_jobs.find(b => b.type === 'core_update')?.final_status || 'none'}

Now check current state:
1. Get current installed plugin versions (call site-info-tool or check-updates-tool)
2. Compare with last known versions in system
3. Identify any plugins that were updated outside the workflow
4. Record manual updates found

Return: {manual_updates_found: boolean, updated_plugins: [{name, old_version, new_version}], details: string}`,
      {
        label: `detect-manual-updates-${siteNum}`,
        phase: 'Maintenance',
        schema: {
          type: 'object',
          properties: {
            manual_updates_found: { type: 'boolean' },
            updated_plugins: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  old_version: { type: 'string' },
                  new_version: { type: 'string' }
                }
              }
            },
            details: { type: 'string' }
          },
          required: ['manual_updates_found', 'details']
        }
      }
    )

    siteResult.steps.manual_updates = {
      found: manualUpdatesResult?.manual_updates_found || false,
      updated_plugins: manualUpdatesResult?.updated_plugins || [],
      details: manualUpdatesResult?.details
    }

    siteResult.step_log.push({
      step_number: '6.5',
      step_name: 'Detect Manual/External Updates',
      status: manualUpdatesResult?.manual_updates_found ? 'found' : 'none_found',
      details: siteResult.steps.manual_updates,
      plugins_count: manualUpdatesResult?.updated_plugins?.length || 0
    })

    if (manualUpdatesResult?.manual_updates_found) {
      log(`  ✅ [${siteNum}] Found ${manualUpdatesResult?.updated_plugins?.length || 0} manually updated plugins`)
    } else {
      log(`  ℹ️  [${siteNum}] No manual updates detected`)
    }

    // Wait 1 minute before sheet sync
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before sheet sync...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    // ========================================================================
    // STEP 8: Sync to Google Sheet (MANDATORY - DO NOT SKIP)
    // ========================================================================

    log(`  8️⃣ [${siteNum}] Syncing results to Google Sheet...`)
    let sheetSyncResult = null
    let sheetRetryCount = 0
    let sheetSuccess = false

    // STRICT: Retry until success or max retries - MUST BE CALLED
    while (sheetSyncResult === null && sheetRetryCount < MAX_RETRIES) {
      try {
        sheetRetryCount++
        const syncResult = await withSharedResourceLimit('sheet-sync', () => agent(
          `Previous steps: External updates found = ${siteResult.steps.external_updates?.found}; Health check = ${finalHealthStatus}.
Attempt ${sheetRetryCount} of ${MAX_RETRIES}.

MUST CALL: smartsites-maintenance:sync-sheets-tool
Parameters: id="${site.site_id}"

If tool not immediately visible, use ToolSearch with query "select:smartsites-maintenance:sync-sheets-tool" to load it first.
Return {synced: boolean, message: string}.`,
          {
            label: `sync-sheets-${siteNum}-attempt${sheetRetryCount}`,
            phase: 'Maintenance',
            schema: {
              type: 'object',
              properties: {
                synced: { type: 'boolean' },
                message: { type: 'string' },
                row: { type: 'number' },
                status: { type: 'string' }
              },
              required: ['synced', 'message']
            }
          }
        ))

        if (syncResult) {
          sheetSyncResult = syncResult
          siteResult.steps.sheet_sync = {
            synced: syncResult?.synced || false,
            row: site.row,
          }
          sheetSuccess = syncResult?.synced || false
          log(`  ✅ [${siteNum}] Sheet synchronized`)
        }
      } catch (e) {
        log(`  ⚠️  [${siteNum}] Sheet sync failed (attempt ${sheetRetryCount}/${MAX_RETRIES})`)
        if (sheetRetryCount < MAX_RETRIES) {
          // Wait 1 minute before retry
          log(`  ⏱️  [${siteNum}] Waiting 1 minute before sheet sync retry...`)
          await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))
        }
        if (sheetRetryCount >= MAX_RETRIES) {
          log(`  ❌ [${siteNum}] CRITICAL: Sheet sync FAILED after ${MAX_RETRIES} retries - STEP NOT SKIPPED`)
          siteResult.steps.sheet_sync = { synced: false, row: site.row, error: e.message, retries_exhausted: true }
        }
      }
    }

    siteResult.step_log.push({
      step_number: 7,
      step_name: 'Sync to Google Sheet',
      status: sheetSuccess ? 'success' : 'failed_with_retries',
      details: siteResult.steps.sheet_sync,
      attempts: sheetRetryCount
    })

    // ========================================================================
    // STEP 9: Send Final Site Report to Google Chat
    // ========================================================================

    // Wait 1 minute before final report
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before final report...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  9️⃣ [${siteNum}] Sending final site maintenance report to Google Chat...`)

    // Only send alert if: actual issues AND there are updates available
    // Don't send if: no issues OR (no plugins available AND no core available)
    const updatesSucceeded = !siteResult.batch_jobs?.some(b => b.final_status === 'failed')
    const sheetSynced = siteResult.steps.sheet_sync?.synced
    const healthOk = siteResult.steps.final_health?.status === 'passed'
    const hasIssues = !(updatesSucceeded && sheetSynced && healthOk)
    const hasUpdatesAvailable = pluginsAvailable > 0 || coreAvailable
    const shouldAlert = hasIssues && hasUpdatesAvailable

    if (shouldAlert) {
      const finalReport = await agent(
        `Site maintenance completed with ISSUES - prepare detailed report:

Site: ${site.url} (ID: ${site.site_id})
Initial Health Status: ${siteResult.steps.initial_health?.status}
Initial Health Details: ${JSON.stringify(siteResult.steps.initial_health?.details)}

Final Health Status: ${siteResult.steps.final_health?.status}
Final Health Details: ${JSON.stringify(siteResult.steps.final_health?.details)}

Update Check Results:
- Plugins Available: ${pluginsAvailable}
- Core Available: ${coreAvailable}
- Core Version: ${coreAvailable ? 'Update needed' : 'Up to date'}

Plugin Update Status: ${siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.final_status || 'N/A'}
Plugin Batch Details: ${JSON.stringify(siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.details)}

Core Update Status: ${siteResult.batch_jobs.find(b => b.type === 'core_update')?.final_status || 'N/A'}
Core Batch Details: ${JSON.stringify(siteResult.batch_jobs.find(b => b.type === 'core_update')?.details)}

Sheet Sync Status: ${siteResult.steps.sheet_sync?.synced ? 'Synced' : 'Failed to sync'}
Sheet Sync Row: ${siteResult.steps.sheet_sync?.row}

External Updates: ${siteResult.steps.external_updates?.found ? 'Found' : 'None'}

Send DETAILED Google Chat ALERT using send_to_chat.py:
Title: "⚠️  Maintenance Issues - ${site.url}"
Body (include ALL details):
🔍 **Site Maintenance Issue Report**
Site: ${site.url} (ID: ${site.site_id})

📊 **Health Status:**
- Initial: ${siteResult.steps.initial_health?.status}
- Final: ${siteResult.steps.final_health?.status}
- Details: ${siteResult.steps.final_health?.details}

🔧 **Updates:**
- Plugins Available: ${pluginsAvailable}
- Plugins Status: ${siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.final_status || 'N/A'}
- Core Available: ${coreAvailable}
- Core Status: ${siteResult.batch_jobs.find(b => b.type === 'core_update')?.final_status || 'N/A'}

📝 **Sync Status:**
- Sheet Synced: ${siteResult.steps.sheet_sync?.synced ? 'Yes' : 'No'}

⚠️ **Issues Detected:**
${!updatesSucceeded ? '- Update job(s) failed' : ''}
${!sheetSynced ? '- Failed to sync with Google Sheet' : ''}
${!healthOk ? '- Health check failed' : ''}

Status: warning

Call send_to_chat.py via Bash with full details. Return {sent: true/false, message: "..."}`,
        {
          label: `chat-alert-${siteNum}`,
          phase: 'Maintenance',
          schema: {
            type: 'object',
            properties: {
              sent: { type: 'boolean' },
              message: { type: 'string' }
            },
            required: ['sent', 'message']
          }
        }
      )

      siteResult.steps.final_report_chat = {
        sent: finalReport?.sent || false,
        alert: true
      }
      log(`  ⚠️  [${siteNum}] Alert sent to Google Chat`)
    } else if (!hasUpdatesAvailable) {
      log(`  ℹ️  [${siteNum}] No updates available - no alert sent (details in daily summary)`)
    } else {
      log(`  ✅ [${siteNum}] Maintenance successful (details in daily summary)`)
    }

    // ========================================================================
    // WRITE INDIVIDUAL SITE LOG TO JSON (right after email, before next site)
    // ========================================================================

    siteResult.status = 'completed'

    log(`  💾 [${siteNum}] Saving site log...`)
    await agent(
      `Write file: log/maintenance_logs/site_${siteResult.site_id}.json
Content: ${JSON.stringify(siteResult)}
Use Python to write. Return {success: true}.`,
      {
        label: `log-${siteNum}`,
        phase: 'Maintenance'
      }
    )
    log(`  ✅ [${siteNum}] Log saved`)

    siteResult.status = 'completed'
    log(`✅ [${siteNum}/${total_sites}] ${site.url} - COMPLETED\n`)

  } catch (error) {
    siteResult.status = 'failed'
    siteResult.error = error.message || String(error)

    // ========================================================================
    // WRITE INDIVIDUAL SITE LOG TO JSON (even on failure)
    // ========================================================================

    log(`  💾 [${siteNum}] Saving site log (failure)...`)
    await agent(
      `Write file: log/maintenance_logs/site_${siteResult.site_id}.json
Content: ${JSON.stringify(siteResult)}
Use Python to write. Return {success: true}.`,
      {
        label: `log-fail-${siteNum}`,
        phase: 'Maintenance'
      }
    )
    log(`  ✅ [${siteNum}] Log saved`)

    log(`❌ [${siteNum}/${total_sites}] ${site.url} - FAILED: ${error.message}\n`)
  }

  return siteResult
}

// Process sites in parallel batches
const SITE_DELAY = 0 // No per-site delay since batch processing handles spacing
let batchNumber = 0

for (let batchStart = 0; batchStart < sites.length; batchStart += PARALLEL_BATCH_SIZE) {
  batchNumber++
  const batch = sites.slice(batchStart, batchStart + PARALLEL_BATCH_SIZE)
  const batchStartNum = batchStart + 1

  log(`📦 Starting batch ${batchNumber} with ${batch.length} sites (${batchStartNum}-${Math.min(batchStartNum + batch.length - 1, total_sites)})...`)

  // Process all sites in this batch concurrently using Promise.all(), but stagger
  // each site's start so their identical fixed-wait sequences don't stay in
  // lock-step and fan out against shared-resource APIs at the same instant.
  const batchResults = await Promise.all(
    batch.map((site, idx) => {
      const staggerDelay = idx * SITE_STAGGER_OFFSET
      return new Promise(resolve => setTimeout(resolve, staggerDelay))
        .then(() => processSiteSequence(site, batchStartNum + idx, total_sites))
    })
  )

  log(`✅ Batch ${batchNumber} completed (${batch.length} sites processed)`)

  // Add results to day summary
  for (const siteResult of batchResults) {
    dayResults.sites_results.push(siteResult)
    if (siteResult.status === 'completed') {
      dayResults.completed++
    } else if (siteResult.status === 'failed') {
      dayResults.failed++
    }
  }

  // Wait before next batch (unless last batch)
  if (batchStart + PARALLEL_BATCH_SIZE < sites.length) {
    log(`⏱️  Waiting ${BATCH_DELAY/1000}s before next batch...`)
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
  }
}

// ============================================================================
// PHASE 3: SEND DAILY SUMMARY
// ============================================================================

phase('Summary')

log(`📊 Daily maintenance completed for ${day}`)
log(`   Total Sites: ${dayResults.total_sites}`)
log(`   Completed: ${dayResults.completed}`)
log(`   Failed: ${dayResults.failed}`)
log(`   Success Rate: ${(dayResults.completed / dayResults.total_sites * 100).toFixed(1)}%`)

const summaryEmail = await agent(
  `Send daily maintenance summary to Google Chat using send_to_chat.py.
Title: "📊 Daily Maintenance Summary - ${day}"
Body:
Total Sites: ${dayResults.total_sites}
Completed: ${dayResults.completed}
Failed: ${dayResults.failed}
Success Rate: ${(dayResults.completed / dayResults.total_sites * 100).toFixed(1)}%

Site Status:
${dayResults.sites_results.map((r, i) => `${i + 1}. ${r.url} - ${r.status.toUpperCase()}`).join('\\n')}

Status: success

Call send_to_chat.py via Bash with escaped newlines. Return {sent: true/false, message: "..."}`,
  {
    label: 'daily-summary-chat',
    phase: 'Summary',
    schema: {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        message: { type: 'string' }
      },
      required: ['sent', 'message']
    }
  }
)

log(`✅ Daily summary sent to Google Chat`)

return {
  success: true,
  day: dayResults.day,
  total_sites: dayResults.total_sites,
  completed: dayResults.completed,
  failed: dayResults.failed,
  success_rate: (dayResults.completed / dayResults.total_sites * 100).toFixed(1),
  sites_results: dayResults.sites_results,
}
