/* =====================================================================
   Congruence Eye — reference data (idempotent)
   Run after 01_schema.sql. The full demo data set (6 stores, 90 days of
   history, Trax data …) is produced by the backend: `npm run seed`.

   Roles (users.role):
     SUPER_ADMIN       all stores; manages master data, users, settings
     ADMIN             all stores; manages master data, users, settings
     REGIONAL_MANAGER  stores in user_stores; reviews checklists, tasks, tickets
     STORE_MANAGER     stores in user_stores; staff roster, POS import, documents, vendors
     AUDITOR           stores in user_stores; checklist templates, audits, reviews
     STAFF             stores in user_stores; submits checklists, works tasks/tickets
   ===================================================================== */
USE [CongruenceEye];
GO

/* ---- settings (key/value); aiServiceUrl defaults to env AI_SERVICE_URL (http://localhost:8000) when not set */
MERGE [dbo].[settings] AS t
USING (VALUES
    (N'engagedStoreDwellSec', N'300'),
    (N'bounceSec',            N'60'),
    (N'repeatWindowDays',     N'30'),
    (N'currency',             N'INR'),
    (N'companyName',          N'Congruence'),
    (N'alertEmailEnabled',    N'false'),
    (N'checklistReminderMinutes', N'60')
) AS s ([key], [value])
ON t.[key] = s.[key]
WHEN NOT MATCHED BY TARGET THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);
GO

/* ---- default administrator (password: Password@123 — change after first login) */
IF NOT EXISTS (SELECT 1 FROM [dbo].[users] WHERE [email] = N'admin@congruence.in')
BEGIN
    INSERT INTO [dbo].[users] ([email], [name], [passwordHash], [role], [isActive])
    VALUES (N'admin@congruence.in', N'Arun Kumar (Admin)', N'$2b$10$hcEB6ud/kgByPrg5kMRPtunR8/ilkK1lx9cxQ7sEBl04mIp6FjKIW', N'SUPER_ADMIN', 1);
END
GO

/* ---- default regions */
IF NOT EXISTS (SELECT 1 FROM [dbo].[regions] WHERE [name] = N'Chennai')
    INSERT INTO [dbo].[regions] ([name]) VALUES (N'Chennai');
IF NOT EXISTS (SELECT 1 FROM [dbo].[regions] WHERE [name] = N'Coimbatore')
    INSERT INTO [dbo].[regions] ([name]) VALUES (N'Coimbatore');
GO
