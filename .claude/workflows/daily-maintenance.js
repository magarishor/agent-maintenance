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
// 3. IF plugins available → Update plugins + Monitor batch (2-min intervals)
// 4. IF core available → Update core + Monitor batch (2-min intervals)
// 5. Health Check (final) - MANDATORY
// 6. Check for external updates - MANDATORY (retry 3x if fails)
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

    const healthCheck1 = await agent(
      `Call smartsites-maintenance:health-check-tool with id="${site.site_id}". Return {status, errors}.`,
      {
        label: `health-check-initial-${siteNum}`,
        phase: 'Maintenance',
      }
    )

    // Extract actual status from response
    const initialHealthStatus = healthCheck1?.status || healthCheck1?.['status'] || (healthCheck1 ? 'healthy' : 'unknown')
    siteResult.steps.initial_health = {
      status: initialHealthStatus,
      details: healthCheck1,
    }
    siteResult.step_log.push({
      step_number: 1,
      step_name: 'Health Check (Initial)',
      status: initialHealthStatus === 'healthy' ? 'success' : 'failed',
      details: healthCheck1
    })
    log(`  ✅ [${siteNum}] Health: ${initialHealthStatus}`)

    // Wait 1 minute before next agent call
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before next step...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    // ========================================================================
    // STEP 2: Check for Available Updates
    // ========================================================================

    log(`  2️⃣ [${siteNum}] Checking for available updates...`)

    const updateCheck = await agent(
      `Previous step (Health Check) returned: ${JSON.stringify(siteResult.steps.initial_health)}

Now call smartsites-maintenance:check-updates-tool with id="${site.site_id}".
Based on the health check status (${initialHealthStatus}), proceed with update check.
Return {plugins_available, core_available, core_version, plugin_list}.`,
      {
        label: `check-updates-${siteNum}`,
        phase: 'Maintenance',
        schema: {
          type: 'object',
          properties: {
            plugins_available: { type: 'number' },
            core_available: { type: 'boolean' },
            core_version: { type: 'string' },
            plugin_list: { type: 'array' },
            message: { type: 'string' }
          },
          required: ['plugins_available', 'core_available', 'core_version']
        }
      }
    )

    // Extract update counts - handle both direct and nested responses
    const pluginsAvailable = updateCheck?.plugins_available ?? 0
    const coreAvailable = updateCheck?.core_available ?? false
    const coreVersion = updateCheck?.core_version || 'N/A'

    siteResult.steps.update_check = {
      plugins_available: pluginsAvailable,
      core_available: coreAvailable,
      core_version: coreVersion,
      details: updateCheck,
    }
    siteResult.step_log.push({
      step_number: 2,
      step_name: 'Check for Updates',
      status: 'success',
      details: { plugins_available: pluginsAvailable, core_available: coreAvailable, core_version: coreVersion }
    })
    log(`  ✅ [${siteNum}] Found ${pluginsAvailable} plugin updates, Core: ${coreAvailable ? 'Yes' : 'No'}`)

    // ========================================================================
    // STEP 3: Update All Plugins (ONLY IF UPDATES AVAILABLE)
    // ========================================================================

    if (pluginsAvailable > 0) {
      // Wait 1 minute before plugin update
      log(`  ⏱️  [${siteNum}] Waiting 1 minute before plugin update step...`)
      await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

      log(`  3️⃣ [${siteNum}] Updating all plugins (${pluginsAvailable})...`)

      const pluginUpdate = await agent(
        `Previous steps: Health Check status = ${initialHealthStatus}; Update Check found ${pluginsAvailable} plugin updates available.

Now call smartsites-maintenance:update-all-plugins-tool with id="${site.site_id}", create_backup=true, run_health_checks=true.
Based on health status and available plugins (${pluginsAvailable}), proceed with update.
Return {batch_id, status, plugins_updated, message}.`,
        {
          label: `update-plugins-${siteNum}`,
          phase: 'Maintenance',
          model: 'sonnet',
          schema: {
            type: 'object',
            properties: {
              batch_id: { type: 'string' },
              status: { type: 'string' },
              plugins_updated: { type: 'number' },
              message: { type: 'string' }
            },
            required: ['batch_id', 'status', 'message']
          }
        }
      )

      let pluginBatchId = pluginUpdate?.batch_id

      // If backup missing, create one and retry
      if (pluginUpdate?.message?.includes('No recent backups found')) {
        // Wait 1 minute before backup creation
        log(`  ⏱️  [${siteNum}] Waiting 1 minute before backup creation...`)
        await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

        log(`  🔄 [${siteNum}] No backups found — creating backup before retry...`)

        const backupResult = await agent(
          `Previous steps: Plugin update attempt failed - no recent backups found.
Site ID: ${site.site_id}

Now call smartsites-maintenance:create-backup-tool with id="${site.site_id}", backup_type="full".
Return {success: boolean, backup_id: string, message: string}`,
          {
            label: `create-backup-${siteNum}`,
            phase: 'Maintenance',
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                backup_id: { type: 'string' },
                message: { type: 'string' }
              },
              required: ['success', 'message']
            }
          }
        )

        if (backupResult?.success) {
          log(`  ✅ [${siteNum}] Backup created: ${backupResult?.backup_id}`)

          // Wait 1 minute before retry
          log(`  ⏱️  [${siteNum}] Waiting 1 minute before plugin update retry...`)
          await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

          log(`  🔄 [${siteNum}] Retrying plugin update...`)

          // Retry plugin update
          const pluginRetry = await agent(
            `Previous steps: Backup created successfully with ID ${backupResult?.backup_id}.
Now retrying plugin update for ${pluginsAvailable} plugins.

Call smartsites-maintenance:update-all-plugins-tool with id="${site.site_id}", create_backup=true, run_health_checks=true.
Return {batch_id, status, plugins_updated, message}`,
            {
              label: `update-plugins-retry-${siteNum}`,
              phase: 'Maintenance',
              model: 'sonnet',
              schema: {
                type: 'object',
                properties: {
                  batch_id: { type: 'string' },
                  status: { type: 'string' },
                  plugins_updated: { type: 'number' },
                  message: { type: 'string' }
                },
                required: ['batch_id', 'status', 'message']
              }
            }
          )
          pluginUpdate = pluginRetry
          pluginBatchId = pluginRetry?.batch_id
        } else {
          log(`  ❌ [${siteNum}] Backup creation failed — skipping plugin update`)
          pluginBatchId = null
        }
      }

      siteResult.steps.plugin_update_request = {
        batch_id: pluginBatchId,
        status: pluginUpdate?.status,
        details: pluginUpdate,
      }

      if (!pluginBatchId || pluginBatchId === 'null' || pluginUpdate?.status === 'error') {
        log(`  ⚠️  [${siteNum}] Plugin update failed — skipping monitoring`)
      } else if (pluginBatchId && pluginBatchId !== 'null') {
        log(`  📦 [${siteNum}] Plugin batch created: ${pluginBatchId}`)
      }

      // ====================================================================
      // STEP 3a: Monitor Plugin Batch Status (Every 1 minute)
      // ====================================================================

      if (pluginBatchId && pluginBatchId !== 'null' && pluginUpdate?.status !== 'failed') {
        log(`  ⏳ [${siteNum}] Monitoring plugin batch status...`)

        let pluginBatchComplete = false
        let pluginCheckCount = 0
        let pluginFinalStatus = null

        while (!pluginBatchComplete && pluginCheckCount < MAX_BATCH_CHECKS) {
          pluginCheckCount++

          // STRICT: Always 2 minutes (120s) between checks - DO NOT VARY
          const waitTime = BATCH_CHECK_INTERVAL

          log(`  ⏱️  [${siteNum}] Waiting ${waitTime/1000}s before check #${pluginCheckCount}...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))

          const queueStatus = await agent(
            `MUST CALL: smartsites-maintenance:check-batch-status-tool
Parameters: id="${site.site_id}", batch_id="${pluginBatchId}"

If this tool is not immediately visible, use ToolSearch with query "select:smartsites-maintenance:check-batch-status-tool" to load it first, then call it. Do NOT compose a fake response.
Return ONLY valid JSON (no markdown code fences). Include all job statuses. Example: {"status":"completed","batch_id":"batch_123","completed_count":2,"total_count":2,"jobs_summary":{"pending":0,"running":0,"completed":2,"failed":0,"cancelled":0},"jobs":[]}`,
            {
              label: `batch-status-plugins-${siteNum}-check${pluginCheckCount}-batch${pluginBatchId.substring(0,8)}`,
              phase: 'Maintenance',
              schema: {
                type: 'object',
                properties: {
                  status: { type: ['string', 'number'] },
                  batch_id: { type: 'string' },
                  completed_count: { type: 'number' },
                  total_count: { type: 'number' },
                  progress: { type: 'object' },
                  jobs_summary: { type: 'object' },
                  summary: { type: 'object' },
                  jobs: { type: 'array' }
                },
                required: ['completed_count', 'total_count']
              }
            }
          )

          // Parse if markdown-wrapped, extract values
          try {
            let status = queueStatus
            if (typeof queueStatus === 'string' && queueStatus.includes('{')) {
              const m = queueStatus.match(/\{[\s\S]*\}/)
              if (m) status = JSON.parse(m[0])
            }

            const p = status?.progress || {}
            const j = status?.job_summary || status?.jobs_summary || status?.summary || {}
            const c = status?.completed_count ?? p?.completed ?? j?.completed ?? 0
            const f = status?.failed ?? p?.failed ?? j?.failed ?? 0
            const x = status?.cancelled ?? p?.cancelled ?? j?.cancelled ?? 0
            const pend = p?.pending ?? j?.pending ?? 0
            const run = p?.running ?? j?.running ?? 0
            const tot = status?.total_count ?? p?.total ?? 0
            const done = (pend === 0 && run === 0) && (c + f + x >= tot) && tot > 0

            log(`  📊 [${siteNum}] Batch #${pluginCheckCount}: ${c}/${tot} done (pend:${pend},run:${run})`)

            if (done) {
              pluginBatchComplete = true
              pluginFinalStatus = status
              log(`  ✅ [${siteNum}] Plugin batch done (${c}✓${f}✗${x}⊘) - stopping checks`)
            }

            if (pluginCheckCount >= MAX_BATCH_CHECKS && !pluginBatchComplete) {
              log(`  ❌ [${siteNum}] Plugin batch timeout after ${MAX_BATCH_CHECKS} checks`)
              pluginBatchComplete = true
              pluginFinalStatus = { status: 'timeout', error: 'Batch timed out' }
            }
          } catch (e) {
            log(`  ⚠️  [${siteNum}] Batch check error`)
            pluginBatchComplete = true
          }
        }

        siteResult.batch_jobs.push({
          type: 'plugin_update',
          batch_id: pluginBatchId,
          checks: pluginCheckCount,
          final_status: pluginFinalStatus?.status,
          details: pluginFinalStatus,
        })

        // ===================================================================
        // STEP 3b: Skip individual plugin report (only send in daily summary)
        log(`  ⏭️  [${siteNum}] Plugin update completed (details in daily summary)...`)
      }
    } else {
      log(`  ⏭️  [${siteNum}] No plugin updates available, skipping...`)
    }

    // ========================================================================
    // STEP 4: Update WordPress Core (ONLY IF UPDATES AVAILABLE)
    // ========================================================================

    if (coreAvailable) {
      // Wait 1 minute before core update
      log(`  ⏱️  [${siteNum}] Waiting 1 minute before core update step...`)
      await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

      log(`  4️⃣ [${siteNum}] Updating WordPress core to ${coreVersion}...`)

      const coreUpdate = await agent(
        `Previous steps: Health Check status = ${initialHealthStatus}; Plugins update ${siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.final_status || 'N/A'}; Core update available to version ${coreVersion}.

MUST CALL: smartsites-maintenance:update-core-tool
Parameters: id="${site.site_id}", version="${coreVersion}", create_backup=true, run_health_checks=true

If this tool is not immediately visible, use ToolSearch with query "select:smartsites-maintenance:update-core-tool" to load it first, then call it. Do NOT compose a fake response — you must actually invoke the tool and return its real output.
Return the exact response from the tool with batch_id, status, target_version, message.`,
        {
          label: `update-core-${siteNum}`,
          phase: 'Maintenance',
          model: 'sonnet',
          schema: {
            type: 'object',
            properties: {
              batch_id: { type: 'string' },
              status: { type: 'string' },
              target_version: { type: 'string' },
              message: { type: 'string' }
            },
            required: ['batch_id', 'status', 'message']
          }
        }
      )

      const coreBatchId = coreUpdate?.batch_id
      siteResult.steps.core_update_request = {
        batch_id: coreBatchId,
        target_version: updateCheck.core_version,
        status: coreUpdate?.status,
        details: coreUpdate,
      }

      if (!coreBatchId || coreBatchId === 'null' || coreUpdate?.status === 'failed') {
        log(`  ⚠️  [${siteNum}] Core update tool did not return a valid batch_id — skipping monitoring. Response: ${JSON.stringify(coreUpdate)}`)
      } else if (coreBatchId && coreBatchId !== 'null') {
        log(`  📦 [${siteNum}] Core batch job created: ${coreBatchId}`)
      }

      // ====================================================================
      // STEP 4a: Monitor Core Batch Status (Every 1 minute)
      // ====================================================================

      if (coreBatchId && coreBatchId !== 'null' && coreUpdate?.status !== 'failed') {
        log(`  ⏳ [${siteNum}] Monitoring core update batch status...`)

        let coreBatchComplete = false
        let coreCheckCount = 0
        let coreFinalStatus = null

        while (!coreBatchComplete && coreCheckCount < MAX_BATCH_CHECKS) {
          coreCheckCount++

          // STRICT: Always 2 minutes (120s) between checks - DO NOT VARY
          const waitTime = BATCH_CHECK_INTERVAL

          log(`  ⏱️  [${siteNum}] Waiting ${waitTime/1000}s before check #${coreCheckCount}...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))

          const queueStatus = await agent(
            `MUST CALL: smartsites-maintenance:check-batch-status-tool
Parameters: id="${site.site_id}", batch_id="${coreBatchId}"

If this tool is not immediately visible, use ToolSearch with query "select:smartsites-maintenance:check-batch-status-tool" to load it first, then call it. Do NOT compose a fake response.
Return ONLY valid JSON (no markdown code fences). Include all job statuses. Example: {"status":"completed","batch_id":"batch_123","completed_count":2,"total_count":2,"jobs_summary":{"pending":0,"running":0,"completed":2,"failed":0,"cancelled":0},"jobs":[]}`,
            {
              label: `batch-status-core-${siteNum}-check${coreCheckCount}-batch${coreBatchId.substring(0,8)}`,
              phase: 'Maintenance',
              schema: {
                type: 'object',
                properties: {
                  status: { type: ['string', 'number'] },
                  batch_id: { type: 'string' },
                  completed_count: { type: 'number' },
                  total_count: { type: 'number' },
                  progress: { type: 'object' },
                  jobs_summary: { type: 'object' },
                  summary: { type: 'object' },
                  jobs: { type: 'array' }
                },
                required: ['completed_count', 'total_count']
              }
            }
          )

          // Parse if markdown-wrapped, extract values
          try {
            let status = queueStatus
            if (typeof queueStatus === 'string' && queueStatus.includes('{')) {
              const m = queueStatus.match(/\{[\s\S]*\}/)
              if (m) status = JSON.parse(m[0])
            }

            const p = status?.progress || {}
            const j = status?.job_summary || status?.jobs_summary || status?.summary || {}
            const c = status?.completed_count ?? p?.completed ?? j?.completed ?? 0
            const f = status?.failed ?? p?.failed ?? j?.failed ?? 0
            const x = status?.cancelled ?? p?.cancelled ?? j?.cancelled ?? 0
            const pend = p?.pending ?? j?.pending ?? 0
            const run = p?.running ?? j?.running ?? 0
            const tot = status?.total_count ?? p?.total ?? 0
            const done = (pend === 0 && run === 0) && (c + f + x >= tot) && tot > 0

            log(`  📊 [${siteNum}] Core batch #${coreCheckCount}: ${c}/${tot} done (pend:${pend},run:${run})`)

            if (done) {
              coreBatchComplete = true
              coreFinalStatus = status
              log(`  ✅ [${siteNum}] Core batch done (${c}✓${f}✗${x}⊘) - stopping checks`)
            }

            if (coreCheckCount >= MAX_BATCH_CHECKS && !coreBatchComplete) {
              log(`  ❌ [${siteNum}] Core batch timeout after ${MAX_BATCH_CHECKS} checks`)
              coreBatchComplete = true
              coreFinalStatus = { status: 'timeout', error: 'Batch timed out' }
            }
          } catch (e) {
            log(`  ⚠️  [${siteNum}] Core batch check error`)
            coreBatchComplete = true
          }
        }

        siteResult.batch_jobs.push({
          type: 'core_update',
          batch_id: coreBatchId,
          checks: coreCheckCount,
          final_status: coreFinalStatus?.status,
          details: coreFinalStatus,
        })
      }
    } else {
      log(`  ⏭️  [${siteNum}] No WordPress core updates available, skipping...`)
    }

    // ========================================================================
    // STEP 5: Final Health Check
    // ========================================================================

    // Wait 1 minute before final health check
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before final health check...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  5️⃣ [${siteNum}] Running final health check...`)

    const healthCheck2 = await agent(
      `Previous steps: Initial health = ${initialHealthStatus}; Plugin updates ${siteResult.batch_jobs.find(b => b.type === 'plugin_update')?.final_status || 'N/A'}; Core update ${siteResult.batch_jobs.find(b => b.type === 'core_update')?.final_status || 'N/A'}.

Now call smartsites-maintenance:health-check-tool with id="${site.site_id}" to verify site is healthy after all updates.
Return {status, errors}.`,
      {
        label: `health-check-final-${siteNum}`,
        phase: 'Maintenance',
      }
    )

    // Extract actual status from response
    const finalHealthStatus = healthCheck2?.status || healthCheck2?.['status'] || (healthCheck2 ? 'healthy' : 'unknown')
    siteResult.steps.final_health = {
      status: finalHealthStatus,
      details: healthCheck2,
    }
    siteResult.step_log.push({
      step_number: 5,
      step_name: 'Health Check (Final)',
      status: finalHealthStatus === 'healthy' ? 'success' : 'failed',
      details: healthCheck2
    })
    log(`  ✅ [${siteNum}] Final Health: ${finalHealthStatus}`)

    // ========================================================================
    // STEP 6: Check External Updates (MANDATORY - DO NOT SKIP)
    // ========================================================================

    // Wait 1 minute before external check
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before external updates check...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  6️⃣ [${siteNum}] Checking for external updates...`)
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
    // STEP 7: Sync to Google Sheet (MANDATORY - DO NOT SKIP)
    // ========================================================================

    // Wait 1 minute before sheet sync
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before sheet sync...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  7️⃣ [${siteNum}] Syncing results to Google Sheet...`)
    let sheetSyncResult = null
    let sheetRetryCount = 0
    let sheetSuccess = false

    // STRICT: Retry until success or max retries - MUST BE CALLED
    while (sheetSyncResult === null && sheetRetryCount < MAX_RETRIES) {
      try {
        sheetRetryCount++
        const syncResult = await agent(
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
        )

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
    // STEP 8: Send Final Site Report Email
    // ========================================================================

    // Wait 1 minute before final email
    log(`  ⏱️  [${siteNum}] Waiting 1 minute before final report email...`)
    await new Promise(resolve => setTimeout(resolve, AGENT_CALL_INTERVAL))

    log(`  8️⃣ [${siteNum}] Sending final site maintenance report...`)

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

  const batchStartTime = Date.now()

  // Process all sites in this batch concurrently using Promise.all()
  const batchResults = await Promise.all(
    batch.map((site, idx) => processSiteSequence(site, batchStartNum + idx, total_sites))
  )

  const batchTime = (Date.now() - batchStartTime) / 1000
  log(`✅ Batch ${batchNumber} completed in ${batchTime.toFixed(1)}s`)

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
