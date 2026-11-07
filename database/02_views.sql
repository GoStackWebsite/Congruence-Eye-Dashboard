/* =====================================================================
   Congruence Eye — reporting views for Power BI / ad-hoc SQL
   Run after 01_schema.sql. Idempotent (CREATE OR ALTER VIEW).
   Metric definitions follow docs/ARCHITECTURE.md:
     conversion % = transactions / billable entities * 100
     missed opportunities = max(0, engaged billable entities - transactions)
   ===================================================================== */
USE [CongruenceEye];
GO

/* Daily KPIs per store (store-local date). */
CREATE OR ALTER VIEW [dbo].[vw_daily_store_kpis]
AS
SELECT
    h.[storeId],
    s.[code]                                   AS storeCode,
    s.[name]                                   AS storeName,
    r.[name]                                   AS regionName,
    s.[city],
    s.[format]                                 AS storeFormat,
    h.[date],
    SUM(h.[footfallIn])                        AS footfall,
    SUM(h.[footfallOut])                       AS footfallOut,
    SUM(h.[uniqueVisitors])                    AS uniqueVisitors,
    SUM(h.[staffEntries])                      AS staffExcluded,
    SUM(h.[individuals])                       AS individuals,
    SUM(h.[groups])                            AS groups,
    SUM(h.[billableEntities])                  AS billableEntities,
    SUM(h.[engaged])                           AS engaged,
    SUM(h.[bounced])                           AS bounced,
    SUM(h.[repeatVisitors])                    AS repeatVisitors,
    SUM(h.[male])                              AS male,
    SUM(h.[female])                            AS female,
    SUM(h.[transactions])                      AS transactions,
    CAST(SUM(h.[revenue]) AS decimal(14,2))    AS revenue,
    SUM(h.[itemsSold])                         AS itemsSold,
    CAST(CASE WHEN SUM(h.[billableEntities]) > 0
              THEN SUM(h.[transactions]) * 100.0 / SUM(h.[billableEntities]) ELSE 0 END AS decimal(9,2)) AS conversionPct,
    CAST(CASE WHEN SUM(h.[transactions]) > 0
              THEN SUM(h.[revenue]) / SUM(h.[transactions]) ELSE 0 END AS decimal(14,2))                AS atv,
    CAST(CASE WHEN SUM(h.[dwellCount]) > 0
              THEN SUM(h.[totalDwellSec]) / SUM(h.[dwellCount]) ELSE 0 END AS decimal(12,1))           AS avgDwellSec,
    CAST(CASE WHEN SUM(h.[footfallIn]) > 0
              THEN SUM(h.[engaged]) * 100.0 / SUM(h.[footfallIn]) ELSE 0 END AS decimal(9,2))          AS engagedPct,
    CAST(CASE WHEN SUM(h.[footfallIn]) > 0
              THEN SUM(h.[bounced]) * 100.0 / SUM(h.[footfallIn]) ELSE 0 END AS decimal(9,2))          AS bounceRatePct,
    CASE WHEN SUM(h.[engagedEntities]) > SUM(h.[transactions])
         THEN SUM(h.[engagedEntities]) - SUM(h.[transactions]) ELSE 0 END                              AS missedOpportunities,
    CAST(CASE WHEN SUM(h.[queueSamples]) > 0
              THEN SUM(h.[avgWaitSec] * h.[queueSamples]) / SUM(h.[queueSamples]) ELSE 0 END AS decimal(12,1)) AS avgQueueWaitSec,
    MAX(h.[maxQueueLength])                    AS maxQueueLength,
    SUM(h.[queueBreaches])                     AS queueBreaches,
    CAST(CASE WHEN MAX(s.[areaSqft]) > 0
              THEN SUM(h.[revenue]) / MAX(s.[areaSqft]) ELSE 0 END AS decimal(12,2))                   AS revenuePerSqft
FROM [dbo].[hourly_store_metrics] h
JOIN [dbo].[stores]  s ON s.[id] = h.[storeId]
JOIN [dbo].[regions] r ON r.[id] = s.[regionId]
GROUP BY h.[storeId], s.[code], s.[name], r.[name], s.[city], s.[format], h.[date];
GO

/* Daily zone performance (sections and queue counters). */
CREATE OR ALTER VIEW [dbo].[vw_zone_performance]
AS
SELECT
    z.[storeId],
    s.[name]                                   AS storeName,
    z.[zoneId],
    zn.[name]                                  AS zoneName,
    zn.[type]                                  AS zoneType,
    z.[date],
    SUM(z.[visits])                            AS visits,
    SUM(z.[uniqueVisitors])                    AS uniqueVisitors,
    SUM(z.[engaged])                           AS engaged,
    CAST(CASE WHEN SUM(z.[visits]) > 0
              THEN SUM(z.[engaged]) * 100.0 / SUM(z.[visits]) ELSE 0 END AS decimal(9,2))         AS engagedPct,
    SUM(z.[bounced])                           AS bounced,
    CAST(CASE WHEN SUM(z.[visits]) > 0
              THEN SUM(z.[bounced]) * 100.0 / SUM(z.[visits]) ELSE 0 END AS decimal(9,2))         AS bouncedPct,
    CAST(CASE WHEN SUM(z.[dwellCount]) > 0
              THEN SUM(z.[totalDwellSec]) / SUM(z.[dwellCount]) ELSE 0 END AS decimal(12,1))      AS avgDwellSec,
    SUM(z.[male])                              AS male,
    SUM(z.[female])                            AS female,
    CAST(CASE WHEN SUM(z.[queueSamples]) > 0
              THEN SUM(z.[avgQueueLength] * z.[queueSamples]) / SUM(z.[queueSamples]) ELSE 0 END AS decimal(9,2)) AS avgQueueLength,
    MAX(z.[maxQueueLength])                    AS maxQueueLength,
    CAST(CASE WHEN SUM(z.[queueSamples]) > 0
              THEN SUM(z.[avgWaitSec] * z.[queueSamples]) / SUM(z.[queueSamples]) ELSE 0 END AS decimal(12,1)) AS avgWaitSec,
    SUM(z.[queueBreaches])                     AS queueBreaches
FROM [dbo].[hourly_zone_metrics] z
JOIN [dbo].[zones]  zn ON zn.[id] = z.[zoneId]
JOIN [dbo].[stores] s  ON s.[id]  = z.[storeId]
GROUP BY z.[storeId], s.[name], z.[zoneId], zn.[name], zn.[type], z.[date];
GO

/* Checklist compliance per store / due date / template category. */
CREATE OR ALTER VIEW [dbo].[vw_checklist_compliance]
AS
SELECT
    a.[storeId],
    s.[name]                                   AS storeName,
    a.[dueDate]                                AS [date],
    t.[category],
    COUNT(*)                                   AS assigned,
    SUM(CASE WHEN a.[status] IN ('SUBMITTED', 'APPROVED', 'REDO') THEN 1 ELSE 0 END) AS submitted,
    SUM(CASE WHEN a.[status] = 'APPROVED' THEN 1 ELSE 0 END)                         AS approved,
    SUM(CASE WHEN a.[status] = 'REDO' THEN 1 ELSE 0 END)                             AS redo,
    SUM(CASE WHEN a.[status] = 'OVERDUE' THEN 1 ELSE 0 END)                          AS overdue,
    SUM(CASE WHEN a.[status] = 'IN_PROGRESS' THEN 1 ELSE 0 END)                      AS inProgress,
    CAST(AVG(sub.[scorePct]) AS decimal(9,2))  AS avgScorePct,
    SUM(ISNULL(sub.[flags], 0))                AS flags
FROM [dbo].[checklist_assignments] a
JOIN [dbo].[stores] s               ON s.[id] = a.[storeId]
JOIN [dbo].[checklist_templates] t  ON t.[id] = a.[templateId]
LEFT JOIN [dbo].[checklist_submissions] sub ON sub.[id] = a.[submissionId]
GROUP BY a.[storeId], s.[name], a.[dueDate], t.[category];
GO

/* AI Manager compliance per store / day / detection type (false positives excluded). */
CREATE OR ALTER VIEW [dbo].[vw_ai_manager_compliance]
AS
SELECT
    d.[storeId],
    s.[name]                                   AS storeName,
    d.[date],
    d.[type],
    SUM(CASE WHEN d.[status] = 'BREACHED' THEN 1 ELSE 0 END) AS breached,
    SUM(CASE WHEN d.[status] = 'COMPLIED' THEN 1 ELSE 0 END) AS complied,
    CAST(CASE WHEN COUNT(*) > 0
              THEN SUM(CASE WHEN d.[status] = 'COMPLIED' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) ELSE 0 END AS decimal(9,2)) AS compliancePct
FROM [dbo].[ai_detections] d
JOIN [dbo].[stores] s ON s.[id] = d.[storeId]
WHERE d.[reviewStatus] IS NULL OR d.[reviewStatus] <> 'FALSE_POSITIVE'
GROUP BY d.[storeId], s.[name], d.[date], d.[type];
GO

/* Contract v3: DVR / NVR health per recorder (status from the latest connection test of each channel).
   Passwords are never exposed (passwordEnc is not selected). */
CREATE OR ALTER VIEW [dbo].[vw_recorder_health]
AS
SELECT
    r.[id]                                     AS recorderId,
    r.[storeId],
    s.[name]                                   AS storeName,
    r.[name],
    r.[kind],
    r.[brand],
    r.[host],
    r.[rtspPort],
    r.[channels],
    r.[status],
    r.[lastCheckedAt],
    (SELECT COUNT(*) FROM [dbo].[cameras] c WHERE c.[recorderId] = r.[id] AND c.[isActive] = 1) AS camerasLinked,
    (SELECT COUNT(*) FROM [dbo].[probes] p WHERE p.[recorderId] = r.[id] AND p.[status] = 'OK'
        AND p.[completedAt] >= DATEADD(day, -7, SYSUTCDATETIME()))                              AS okTests7d,
    (SELECT COUNT(*) FROM [dbo].[probes] p WHERE p.[recorderId] = r.[id] AND p.[status] = 'FAILED'
        AND p.[completedAt] >= DATEADD(day, -7, SYSUTCDATETIME()))                              AS failedTests7d
FROM [dbo].[recorders] r
JOIN [dbo].[stores] s ON s.[id] = r.[storeId];
GO
