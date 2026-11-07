/* =====================================================================
   Congruence Eye — SQL Server 2022 schema
   Generated from the backend TypeORM entities (npm run ddl). Mirrors
   table/column/constraint names exactly so that the API can run with
   DB_SYNC=false against this database.
   All timestamps are UTC (datetime2); 'date' columns are store-local
   YYYY-MM-DD strings and 'hour' columns 0..23 store-local.
   ===================================================================== */
IF DB_ID(N'CongruenceEye') IS NULL
BEGIN
    CREATE DATABASE [CongruenceEye];
END
GO
USE [CongruenceEye];
GO

IF OBJECT_ID(N'dbo.ai_detections', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ai_detections] (
        [id] int IDENTITY(1,1) NOT NULL,
        [ruleId] int NULL,
        [type] nvarchar(30) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [zoneId] int NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [status] nvarchar(10) NOT NULL,
        [details] nvarchar(1000) NULL,
        [confidence] float NULL,
        [snapshotId] int NULL,
        [reviewStatus] nvarchar(20) NULL,
        [reviewedById] int NULL,
        [alertId] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_d6b50ff6624356dd85908f3b535] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_723f0415fe150e372e2f605854a] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.ai_manager_rules', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ai_manager_rules] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [type] nvarchar(30) NOT NULL,
        [storeIds] nvarchar(MAX) NOT NULL,
        [zoneIds] nvarchar(MAX) NOT NULL,
        [windowStart] nvarchar(5) NOT NULL CONSTRAINT [DF_e918976c5105e98bb972bc33945] DEFAULT '00:00',
        [windowEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_d36499f050472da201179c81a34] DEFAULT '23:59',
        [daysOfWeek] nvarchar(MAX) NOT NULL,
        [params] nvarchar(MAX) NOT NULL,
        [severity] nvarchar(10) NOT NULL CONSTRAINT [DF_f29df44e417c9a4855b72a61e9e] DEFAULT 'MEDIUM',
        [notifyChannels] nvarchar(MAX) NOT NULL,
        [notifyEmails] nvarchar(1000) NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_5bc14b4dfb925827465e2594f0a] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_53336bb0af2a7aba79c35a54bbb] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_40701df69a16341ae27435eb36c] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.regions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[regions] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(100) NOT NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_133912903ed8b6adc012151abe9] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_4fcd12ed6a046276e2deb08801c] PRIMARY KEY ([id]),
        CONSTRAINT [UQ_1eb9a8899a7db89f6ba473fd847] UNIQUE ([name])
    );
END
GO

IF OBJECT_ID(N'dbo.stores', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[stores] (
        [id] int IDENTITY(1,1) NOT NULL,
        [code] nvarchar(30) NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [regionId] int NOT NULL,
        [city] nvarchar(100) NOT NULL CONSTRAINT [DF_9a8b1293e56097f615d488b2539] DEFAULT '',
        [address] nvarchar(400) NOT NULL CONSTRAINT [DF_8a421ad709f5775133c313e676a] DEFAULT '',
        [timezone] nvarchar(64) NOT NULL CONSTRAINT [DF_de09e43bdb6d22ff5d13d486ea2] DEFAULT 'Asia/Kolkata',
        [openTime] nvarchar(5) NOT NULL CONSTRAINT [DF_8358dfd33d7838c0396656ff62d] DEFAULT '10:00',
        [closeTime] nvarchar(5) NOT NULL CONSTRAINT [DF_fd7dd81306d6904621cb47c7d06] DEFAULT '21:30',
        [areaSqft] int NOT NULL CONSTRAINT [DF_30394761973493562d58e6ec69f] DEFAULT 0,
        [format] nvarchar(20) NOT NULL CONSTRAINT [DF_75ca83f68cc09abf939fd57786f] DEFAULT 'HIGH_STREET',
        [isActive] bit NOT NULL CONSTRAINT [DF_b8ad2583e5874246fc7bc885637] DEFAULT 1,
        [latitude] float NULL,
        [longitude] float NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_571707c9853a152317bebfd030f] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_7aa6e7d71fa7acdd7ca43d7c9cb] PRIMARY KEY ([id]),
        CONSTRAINT [UQ_72bdebc754d6a689b3c169cab8a] UNIQUE ([code])
    );
END
GO

IF OBJECT_ID(N'dbo.alert_rules', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[alert_rules] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [storeId] int NULL,
        [metric] nvarchar(30) NOT NULL,
        [threshold] float NOT NULL,
        [severity] nvarchar(10) NOT NULL CONSTRAINT [DF_1943948aaeeb4cb3e180a7069f6] DEFAULT 'MEDIUM',
        [channels] nvarchar(MAX) NOT NULL,
        [emails] nvarchar(1000) NULL,
        [webhookUrl] nvarchar(500) NULL,
        [cooldownMin] int NOT NULL CONSTRAINT [DF_4dc958a24f63f2fe51993be6e67] DEFAULT 30,
        [autoTicket] bit NOT NULL CONSTRAINT [DF_02d709c47dcb004c5597f6d3273] DEFAULT 0,
        [isActive] bit NOT NULL CONSTRAINT [DF_582a7980ea588b57f3af6b7f152] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_2ab7f79de08337adb58fdc48ae5] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_ae580564f087ffab9d229225aec] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.alerts', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[alerts] (
        [id] int IDENTITY(1,1) NOT NULL,
        [ruleId] int NULL,
        [ruleName] nvarchar(150) NOT NULL,
        [storeId] int NOT NULL,
        [metric] nvarchar(30) NOT NULL,
        [severity] nvarchar(10) NOT NULL,
        [message] nvarchar(1000) NOT NULL,
        [value] float NOT NULL CONSTRAINT [DF_125f166e599612855ac0a32604c] DEFAULT 0,
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_b63189bf8e5abf5b9188acca964] DEFAULT 'OPEN',
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_8bb8f7c97396b99b57794c5999c] DEFAULT SYSUTCDATETIME(),
        [acknowledgedAt] datetime2 NULL,
        [acknowledgedById] int NULL,
        [resolvedAt] datetime2 NULL,
        [resolvedById] int NULL,
        [ticketId] int NULL,
        CONSTRAINT [PK_60f895662df096bfcdfab7f4b96] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[audit_logs] (
        [id] int IDENTITY(1,1) NOT NULL,
        [userId] int NULL,
        [userName] nvarchar(150) NOT NULL CONSTRAINT [DF_f14cf382d49d8736772aa83bdd3] DEFAULT '',
        [action] nvarchar(30) NOT NULL,
        [entity] nvarchar(60) NOT NULL,
        [entityId] int NULL,
        [details] nvarchar(MAX) NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_c69efb19bf127c97e6740ad5300] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_1bb179d048bbc581caa3b013439] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.camera_status_log', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[camera_status_log] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [status] nvarchar(20) NOT NULL,
        [startedAt] datetime2 NOT NULL,
        [endedAt] datetime2 NULL,
        [reason] nvarchar(300) NULL,
        CONSTRAINT [PK_925cfcfaea9b34553732582fa41] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.recorders', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[recorders] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [kind] nvarchar(10) NOT NULL CONSTRAINT [DF_16a43064ec69a98ade449ab0552] DEFAULT 'DVR',
        [brand] nvarchar(20) NOT NULL,
        [host] nvarchar(255) NOT NULL,
        [rtspPort] int NOT NULL CONSTRAINT [DF_7f51d4bb791890b1a5145ff3e1f] DEFAULT 554,
        [httpPort] int NOT NULL CONSTRAINT [DF_69b3ce1c5a3fc2b04c8fb35c2d4] DEFAULT 80,
        [username] nvarchar(100) NOT NULL CONSTRAINT [DF_12fcd64f896015aac106c1abc77] DEFAULT '',
        [passwordEnc] nvarchar(500) NULL,
        [channels] int NOT NULL,
        [stream] nvarchar(4) NOT NULL CONSTRAINT [DF_b58eab7f5583709c1a9f37fdfbf] DEFAULT 'MAIN',
        [urlTemplate] nvarchar(500) NULL,
        [status] nvarchar(10) NOT NULL CONSTRAINT [DF_d19ee79a85e821773f8d584cdf1] DEFAULT 'UNKNOWN',
        [lastCheckedAt] datetime2 NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_6d0799c5a43f11e10b6a076887e] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_4027c8f608802bd24003848b093] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_01e12d022439868a2db7beed353] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.cameras', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[cameras] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [rtspUrl] nvarchar(500) NOT NULL CONSTRAINT [DF_c47c504d7e5ec794bc6f1a203b4] DEFAULT '',
        [type] nvarchar(20) NOT NULL CONSTRAINT [DF_0f7ef819fee302f779f9089a5d0] DEFAULT 'GENERAL',
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_dcf3a964d6fb0f584a80d51efb9] DEFAULT 'UNKNOWN',
        [lastHeartbeatAt] datetime2 NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_139470fbdab0b25ec6bb3476815] DEFAULT 1,
        [fps] float NULL,
        [recorderId] int NULL,
        [channel] int NULL,
        [streamProfile] nvarchar(4) NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f96791be5d31265c2bbbec5d238] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_88b40b9817f9f422121f861e1e8] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_templates', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_templates] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(200) NOT NULL,
        [description] nvarchar(1000) NOT NULL CONSTRAINT [DF_c985afbe3486cf14e5a83db98ce] DEFAULT '',
        [category] nvarchar(30) NOT NULL CONSTRAINT [DF_a21fbd47c708849d061e62802aa] DEFAULT 'OTHER',
        [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_9220544d00f8b9cb0e19be729d0] DEFAULT 'ADHOC',
        [isActive] bit NOT NULL CONSTRAINT [DF_d1d8c0cc4077a594f3fa9dbe4c3] DEFAULT 1,
        [version] int NOT NULL CONSTRAINT [DF_2b67de7292b485213b610f91154] DEFAULT 1,
        [createdById] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_9c6c15d43cf487bd36d5e13a89c] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_0cf1a0f0415705c7642aa8590c9] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_e6d17651d110bbac45cf07e44fa] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[users] (
        [id] int IDENTITY(1,1) NOT NULL,
        [email] nvarchar(200) NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [passwordHash] nvarchar(200) NOT NULL,
        [role] nvarchar(30) NOT NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_409a0298fdd86a6495e23c25c66] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_204e9b624861ff4a5b268192101] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_0f5cbe00928ba4489cc7312573b] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_a3ffb1c0c8416b9fc6f907b7433] PRIMARY KEY ([id]),
        CONSTRAINT [UQ_97672ac88f789774dd47f7c8be3] UNIQUE ([email])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_submissions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_submissions] (
        [id] int IDENTITY(1,1) NOT NULL,
        [assignmentId] int NULL,
        [templateId] int NOT NULL,
        [storeId] int NOT NULL,
        [submittedById] int NOT NULL,
        [submittedAt] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [score] float NOT NULL CONSTRAINT [DF_49e0b05bfa3c9b49ebccdc3c794] DEFAULT 0,
        [maxScore] float NOT NULL CONSTRAINT [DF_3b022acc5c50dfef848df325d7c] DEFAULT 0,
        [scorePct] float NOT NULL CONSTRAINT [DF_aaf36d4f25a397d6ee96340268d] DEFAULT 0,
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_4122324cf4a3240bf4fc37f1d9d] DEFAULT 'SUBMITTED',
        [flags] int NOT NULL CONSTRAINT [DF_d8c710dd5c13e3bdd0498b8673f] DEFAULT 0,
        [reviewerComment] nvarchar(2000) NULL,
        [reviewedById] int NULL,
        [reviewedAt] datetime2 NULL,
        [templateVersion] int NULL,
        [templateSnapshot] nvarchar(MAX) NULL,
        [isLate] bit NOT NULL CONSTRAINT [DF_be0e68f7854bb4a53244039a813] DEFAULT 0,
        CONSTRAINT [PK_4754fd398dd9b917f63b63bb389] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_questions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_questions] (
        [id] int IDENTITY(1,1) NOT NULL,
        [templateId] int NOT NULL,
        [section] nvarchar(150) NOT NULL CONSTRAINT [DF_7b994e64c3162c3642ee50c2df2] DEFAULT 'General',
        [text] nvarchar(1000) NOT NULL,
        [type] nvarchar(20) NOT NULL,
        [options] nvarchar(MAX) NULL,
        [correctOptions] nvarchar(MAX) NULL,
        [required] bit NOT NULL CONSTRAINT [DF_483e374eed53332f1d49fef8e5f] DEFAULT 1,
        [weight] float NOT NULL CONSTRAINT [DF_38f19d5af2e490951b32c68e89b] DEFAULT 1,
        [requiresPhoto] bit NOT NULL CONSTRAINT [DF_141872affe51645d1cec3a14e4e] DEFAULT 0,
        [sortOrder] int NOT NULL CONSTRAINT [DF_985557758494ecd63df58b16bcb] DEFAULT 0,
        [minValue] float NULL,
        [maxValue] float NULL,
        [referenceImageUrl] nvarchar(500) NULL,
        [aiCheck] nvarchar(20) NOT NULL CONSTRAINT [DF_e14766787b53969798e61652c11] DEFAULT 'NONE',
        [createTaskOnFail] bit NOT NULL CONSTRAINT [DF_14859ed174b1cb1dc0da853ac61] DEFAULT 0,
        [isActive] bit NOT NULL CONSTRAINT [DF_93e9b4f3cf1dd37e3cbf697c2ad] DEFAULT 1,
        CONSTRAINT [PK_7a01bfc19ecb098658937a8d1fc] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_answers', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_answers] (
        [id] int IDENTITY(1,1) NOT NULL,
        [submissionId] int NOT NULL,
        [questionId] int NOT NULL,
        [value] nvarchar(MAX) NULL,
        [photoUrl] nvarchar(500) NULL,
        [remark] nvarchar(1000) NULL,
        [score] float NOT NULL CONSTRAINT [DF_17362d6cb543d1e5dd8d59fb787] DEFAULT 0,
        [maxScore] float NOT NULL CONSTRAINT [DF_62bf548960d8f00b77580666e42] DEFAULT 0,
        [redo] bit NOT NULL CONSTRAINT [DF_acc51f1dd70d42b3fbcb9726265] DEFAULT 0,
        [aiResult] nvarchar(MAX) NULL,
        [flagged] bit NOT NULL CONSTRAINT [DF_cd58882e8b1c4c0c1dc9d5bf6ab] DEFAULT 0,
        CONSTRAINT [PK_cf16b29f4863ce6a7cfd05be884] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_assignments', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_assignments] (
        [id] int IDENTITY(1,1) NOT NULL,
        [templateId] int NOT NULL,
        [storeId] int NOT NULL,
        [assigneeId] int NOT NULL,
        [assignedById] int NULL,
        [dueDate] varchar(10) NOT NULL,
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_82e7b8e8c0032247fcc5da4ea99] DEFAULT 'PENDING',
        [submissionId] int NULL,
        [dueAt] datetime2 NULL,
        [windowStart] datetime2 NULL,
        [scheduleId] int NULL,
        [draftAnswers] nvarchar(MAX) NULL,
        [remindedAt] datetime2 NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_ecad556308c738ed37fc8857209] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_afdf88515f8c40789371d29889f] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.checklist_schedules', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[checklist_schedules] (
        [id] int IDENTITY(1,1) NOT NULL,
        [templateId] int NOT NULL,
        [storeIds] nvarchar(MAX) NOT NULL,
        [assigneeId] int NULL,
        [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_74f3f976048ef68b2316d872a99] DEFAULT 'DAILY',
        [repeatEvery] int NOT NULL CONSTRAINT [DF_b07affa8a1fe4b467c402539cc0] DEFAULT 1,
        [daysOfWeek] nvarchar(MAX) NOT NULL,
        [dayOfMonth] int NULL,
        [windowStart] nvarchar(5) NOT NULL CONSTRAINT [DF_f8ceb1ea9b264d7cc7253ec360d] DEFAULT '09:00',
        [windowEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_83a68f5714aaa7e7d8aea3fcc2a] DEFAULT '18:00',
        [startDate] varchar(10) NOT NULL,
        [endDate] varchar(10) NULL,
        [reminderMinutesBefore] int NOT NULL CONSTRAINT [DF_65f921d57ae8537781a8946c382] DEFAULT 60,
        [isActive] bit NOT NULL CONSTRAINT [DF_18bfc5cd25cc98d4bb0835a96c2] DEFAULT 1,
        [lastGeneratedDate] varchar(10) NULL,
        [createdById] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_ec25496a81982da5a3a2da7eab6] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_0493b92eeb87cbaf5be3ed22304] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.discovered_devices', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[discovered_devices] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [host] nvarchar(255) NOT NULL,
        [rtspPort] int NOT NULL CONSTRAINT [DF_6032e0dfcd5991a4911b27931c3] DEFAULT 554,
        [httpPort] int NULL,
        [brandGuess] nvarchar(20) NULL,
        [onvif] bit NOT NULL CONSTRAINT [DF_5c749a1326e519e2ccbf7da2764] DEFAULT 0,
        [seenAt] datetime2 NOT NULL,
        CONSTRAINT [PK_23e5b766a589f5d7e7f59e67c24] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.documents', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[documents] (
        [id] int IDENTITY(1,1) NOT NULL,
        [title] nvarchar(200) NOT NULL,
        [category] nvarchar(20) NOT NULL CONSTRAINT [DF_b20c1ae2c7098e9a822f15aa6fc] DEFAULT 'OTHER',
        [storeId] int NULL,
        [fileName] nvarchar(260) NOT NULL,
        [storedName] nvarchar(300) NOT NULL,
        [mimeType] nvarchar(120) NOT NULL CONSTRAINT [DF_9f16120de147269a69e69ef5938] DEFAULT 'application/octet-stream',
        [size] int NOT NULL CONSTRAINT [DF_c00ec23d524c9d104ef435ccb89] DEFAULT 0,
        [uploadedById] int NOT NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f8cc10f6d16ee343bbf23b829ed] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_ac51aa5181ee2036f5ca482857c] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.edge_devices', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[edge_devices] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [apiKeyHash] nvarchar(64) NOT NULL,
        [apiKeyPrefix] nvarchar(12) NOT NULL,
        [version] nvarchar(50) NULL,
        [lastSeenAt] datetime2 NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_a039e104e1a4236e4046c8861a0] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_a4f0c098c570b229b056155b557] PRIMARY KEY ([id]),
        CONSTRAINT [UQ_a181ad29addc5699fdfbc8cb9e3] UNIQUE ([apiKeyHash])
    );
END
GO

IF OBJECT_ID(N'dbo.heatmap_frames', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[heatmap_frames] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [width] int NOT NULL CONSTRAINT [DF_4f010a03393ad48b1ee53f68fe9] DEFAULT 32,
        [height] int NOT NULL CONSTRAINT [DF_fcef925118ae4b48461a0030270] DEFAULT 18,
        [grid] nvarchar(MAX) NOT NULL,
        [samples] int NOT NULL CONSTRAINT [DF_6955790935bb7598eb84d68ac8a] DEFAULT 0,
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_ef84e6bcbcf3e6345b3c4a6350e] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_c91ff295d229c778de063e6fdc5] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.hourly_store_metrics', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[hourly_store_metrics] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [footfallIn] int NOT NULL CONSTRAINT [DF_cd6a67043aad4cf09a80814ff8a] DEFAULT 0,
        [footfallOut] int NOT NULL CONSTRAINT [DF_cfed1f0cf1f6fe126133f65ef52] DEFAULT 0,
        [uniqueVisitors] int NOT NULL CONSTRAINT [DF_1da284d9e468dae9387bffc3963] DEFAULT 0,
        [staffEntries] int NOT NULL CONSTRAINT [DF_541de23a921fe0c7550d5083c9e] DEFAULT 0,
        [individuals] int NOT NULL CONSTRAINT [DF_56347b2ff245fdad82fcefe2a46] DEFAULT 0,
        [groups] int NOT NULL CONSTRAINT [DF_89ea82fdd23ec0574b61f5e69ed] DEFAULT 0,
        [billableEntities] int NOT NULL CONSTRAINT [DF_db7767ddd55af67a55b3d064144] DEFAULT 0,
        [engaged] int NOT NULL CONSTRAINT [DF_e1d0ad1eddf82ff596f9320f097] DEFAULT 0,
        [engagedEntities] int NOT NULL CONSTRAINT [DF_f9aad7870535e585d4aea3bf547] DEFAULT 0,
        [bounced] int NOT NULL CONSTRAINT [DF_e6548efd2e84a4a6a318cdc6cbb] DEFAULT 0,
        [repeatVisitors] int NOT NULL CONSTRAINT [DF_b7c12b9de6be7a677ddd6e662e0] DEFAULT 0,
        [male] int NOT NULL CONSTRAINT [DF_fd80a44e318164792c66af452f9] DEFAULT 0,
        [female] int NOT NULL CONSTRAINT [DF_1f5fb5a4d47f8f2ddcea6c3600a] DEFAULT 0,
        [genderUnknown] int NOT NULL CONSTRAINT [DF_5788051b980fddc3f67f25fca29] DEFAULT 0,
        [age_0_17] int NOT NULL CONSTRAINT [DF_65438c4c3ffeacdc61b9bea5ea5] DEFAULT 0,
        [age_18_24] int NOT NULL CONSTRAINT [DF_a6fd71c8d7a32965bd3af131b98] DEFAULT 0,
        [age_25_34] int NOT NULL CONSTRAINT [DF_445f4d574e55b9993fe1916046f] DEFAULT 0,
        [age_35_44] int NOT NULL CONSTRAINT [DF_449b001c3fefa171911afde88c0] DEFAULT 0,
        [age_45_54] int NOT NULL CONSTRAINT [DF_50e60ed075ca9b5d756e90f39a5] DEFAULT 0,
        [age_55_plus] int NOT NULL CONSTRAINT [DF_2de1dc934f75879614b121120a7] DEFAULT 0,
        [ageUnknown] int NOT NULL CONSTRAINT [DF_fed63826f74c0570361bbeec579] DEFAULT 0,
        [male_0_17] int NOT NULL CONSTRAINT [DF_1aab98049c07aa0ec5a2f798c5c] DEFAULT 0,
        [male_18_24] int NOT NULL CONSTRAINT [DF_bb53cd4778cf69321a7545565bd] DEFAULT 0,
        [male_25_34] int NOT NULL CONSTRAINT [DF_5a891138bb68c8e60616c98417b] DEFAULT 0,
        [male_35_44] int NOT NULL CONSTRAINT [DF_59989c71119ca4fce5b6ee56a62] DEFAULT 0,
        [male_45_54] int NOT NULL CONSTRAINT [DF_6dd12773e4d0724b8780fe5ebce] DEFAULT 0,
        [male_55_plus] int NOT NULL CONSTRAINT [DF_de1eae0b6ebe22e700931eaf064] DEFAULT 0,
        [female_0_17] int NOT NULL CONSTRAINT [DF_838a3df2e7d17bb1475c636d08b] DEFAULT 0,
        [female_18_24] int NOT NULL CONSTRAINT [DF_8a40f774a0b9b1331a701f34cdd] DEFAULT 0,
        [female_25_34] int NOT NULL CONSTRAINT [DF_bdc0e2d3359ace4c87a23f0198e] DEFAULT 0,
        [female_35_44] int NOT NULL CONSTRAINT [DF_e3e65ae6aa70b6550fe15c1990c] DEFAULT 0,
        [female_45_54] int NOT NULL CONSTRAINT [DF_f9c53fb69c5ba4d4c17f54dbb3a] DEFAULT 0,
        [female_55_plus] int NOT NULL CONSTRAINT [DF_75a298f75d267e2b82f07bea968] DEFAULT 0,
        [totalDwellSec] float NOT NULL CONSTRAINT [DF_4a5bfa5732a4351d03ed2aa2aa9] DEFAULT 0,
        [dwellCount] int NOT NULL CONSTRAINT [DF_6c49270a1b1b464c0d1bc7562bc] DEFAULT 0,
        [transactions] int NOT NULL CONSTRAINT [DF_437a31d0990bd0d337c1e6286e5] DEFAULT 0,
        [revenue] decimal(12,2) NOT NULL CONSTRAINT [DF_5903b1980645a9bf59d3e8a06b7] DEFAULT 0,
        [itemsSold] int NOT NULL CONSTRAINT [DF_11f31730164ffa3118520bde8e5] DEFAULT 0,
        [avgQueueLength] float NOT NULL CONSTRAINT [DF_2ef090f43d49766cdcf13496918] DEFAULT 0,
        [maxQueueLength] int NOT NULL CONSTRAINT [DF_864e339d3c7fc4256a7446b75b8] DEFAULT 0,
        [avgWaitSec] float NOT NULL CONSTRAINT [DF_4b23171bfb2f5c3d455cb674b9a] DEFAULT 0,
        [maxWaitSec] float NOT NULL CONSTRAINT [DF_050b31e5de5473ca2983782b7f2] DEFAULT 0,
        [queueSamples] int NOT NULL CONSTRAINT [DF_ea3b529118da6cd9ff11592f127] DEFAULT 0,
        [queueBreaches] int NOT NULL CONSTRAINT [DF_e2f8b7a88d5917217b687fc4f4a] DEFAULT 0,
        [unattendedSec] float NOT NULL CONSTRAINT [DF_90a7fb4a4299e47b1f3b3c7b7e9] DEFAULT 0,
        [staffPresentAvg] float NOT NULL CONSTRAINT [DF_6862d66a96333d47fdcf551a3f7] DEFAULT 0,
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_16bc50bde814c7855a33f7b0d95] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_03572947351b737de9257613668] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.hourly_zone_metrics', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[hourly_zone_metrics] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [zoneId] int NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [visits] int NOT NULL CONSTRAINT [DF_26b6bd1d23d3c45a0e5fcc25c84] DEFAULT 0,
        [uniqueVisitors] int NOT NULL CONSTRAINT [DF_41461661be4f4cad75db38cc3e7] DEFAULT 0,
        [totalDwellSec] float NOT NULL CONSTRAINT [DF_da04e0656b7336ab72524aa12a6] DEFAULT 0,
        [dwellCount] int NOT NULL CONSTRAINT [DF_298df369880a478ba07e48c24d0] DEFAULT 0,
        [engaged] int NOT NULL CONSTRAINT [DF_b7046694dc013ce0618342109c2] DEFAULT 0,
        [male] int NOT NULL CONSTRAINT [DF_fa3c0e026e455f6d4e98fedd3ee] DEFAULT 0,
        [female] int NOT NULL CONSTRAINT [DF_1a8761ef3489dcd4ea274ffe381] DEFAULT 0,
        [bounced] int NOT NULL CONSTRAINT [DF_8600d17e8d9d97cab564a3a9ec1] DEFAULT 0,
        [age_0_17] int NOT NULL CONSTRAINT [DF_c2422d54357f5544f9585b72cd6] DEFAULT 0,
        [age_18_24] int NOT NULL CONSTRAINT [DF_d7fc918c1e1b152c59b97d4b24c] DEFAULT 0,
        [age_25_34] int NOT NULL CONSTRAINT [DF_eaa9975657bfaefc14b837bf301] DEFAULT 0,
        [age_35_44] int NOT NULL CONSTRAINT [DF_5905346b237fcfea3927f506752] DEFAULT 0,
        [age_45_54] int NOT NULL CONSTRAINT [DF_e90f5d42c18d7eebf15991cea3c] DEFAULT 0,
        [age_55_plus] int NOT NULL CONSTRAINT [DF_0443c260d67aa0483325b6ad78c] DEFAULT 0,
        [queueSamples] int NOT NULL CONSTRAINT [DF_c18e198a6dcd80aafb63dcff164] DEFAULT 0,
        [avgQueueLength] float NOT NULL CONSTRAINT [DF_5ec5d16984a04797cb1be23004a] DEFAULT 0,
        [maxQueueLength] int NOT NULL CONSTRAINT [DF_b8d8696ca2d9aa03b6cc65777fc] DEFAULT 0,
        [avgWaitSec] float NOT NULL CONSTRAINT [DF_36db8f2df450075eb9fb09960d6] DEFAULT 0,
        [maxWaitSec] float NOT NULL CONSTRAINT [DF_dc0db5daa8dc6185e987d7bd40e] DEFAULT 0,
        [queueBreaches] int NOT NULL CONSTRAINT [DF_216195b744ba72d3ded51de4a12] DEFAULT 0,
        [unattendedSec] float NOT NULL CONSTRAINT [DF_16c1855731cb94135cf8fb9de67] DEFAULT 0,
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_8cc1943efc1bc36d485a8b1f390] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_08fabc26a971c8869ff6aa1b1bb] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.ingest_batches', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ingest_batches] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [kind] nvarchar(20) NOT NULL,
        [batchId] nvarchar(64) NOT NULL,
        [response] nvarchar(MAX) NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_3a21a7c7520a0fb98ef91d843c7] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_184779a7b0f00cff933f3121f38] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[notifications] (
        [id] int IDENTITY(1,1) NOT NULL,
        [userId] int NOT NULL,
        [title] nvarchar(200) NOT NULL,
        [body] nvarchar(1000) NOT NULL CONSTRAINT [DF_e26a5e8baf69121e8bea1ada5d4] DEFAULT '',
        [link] nvarchar(300) NULL,
        [isRead] bit NOT NULL CONSTRAINT [DF_8ba28344602d583583b9ea1a500] DEFAULT 0,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_831a5a06f879fb0bebf89658713] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_6a72c3c0f683f6462415e653c3a] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.pos_transactions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[pos_transactions] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [billNo] nvarchar(60) NOT NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [amount] decimal(12,2) NOT NULL,
        [itemsCount] int NOT NULL CONSTRAINT [DF_f343ac89aa3f09a09040a1ac1d3] DEFAULT 1,
        [staffCode] nvarchar(30) NULL,
        [source] nvarchar(10) NOT NULL CONSTRAINT [DF_61bf90510d19e1b1098850f920e] DEFAULT 'API',
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_345a34e3d48e2a337baf0c4129f] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_528a082f1148d438d20b0476a52] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.probes', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[probes] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NULL,
        [recorderId] int NULL,
        [channel] int NULL,
        [streamProfile] nvarchar(4) NULL,
        [status] nvarchar(10) NOT NULL CONSTRAINT [DF_74faa2491604c3fe096a88e4421] DEFAULT 'PENDING',
        [requestedAt] datetime2 NOT NULL,
        [claimedAt] datetime2 NULL,
        [completedAt] datetime2 NULL,
        [width] int NULL,
        [height] int NULL,
        [fps] float NULL,
        [codec] nvarchar(30) NULL,
        [latencyMs] int NULL,
        [error] nvarchar(500) NULL,
        [errorCode] nvarchar(20) NULL,
        [snapshotPath] nvarchar(300) NULL,
        [requestedById] int NULL,
        CONSTRAINT [PK_7c839c90f8cb3aff3f99b122d0f] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.queue_snapshots', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[queue_snapshots] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [zoneId] int NOT NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [queueLength] int NOT NULL,
        [avgWaitSec] float NOT NULL,
        [counterStaffed] bit NOT NULL CONSTRAINT [DF_1cd01e92d6f0b27aa68cd6942c8] DEFAULT 1,
        CONSTRAINT [PK_65b643f4ee56c8a0a3d5fd49ebd] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.recaps', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[recaps] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [date] varchar(10) NOT NULL,
        [status] nvarchar(10) NOT NULL CONSTRAINT [DF_ef4f9d41a7844cff29e4b410bd0] DEFAULT 'PENDING',
        [filePath] nvarchar(400) NULL,
        [durationSec] float NOT NULL CONSTRAINT [DF_71f3261f224831e40ac099f11cd] DEFAULT 0,
        [frameCount] int NOT NULL CONSTRAINT [DF_cffbcb059f48ba67b9675b96acb] DEFAULT 0,
        [error] nvarchar(1000) NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f506b11c85b01b1e2f06f14d5a9] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_4bdbca1862dad14f939c8e9b121] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.report_schedules', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[report_schedules] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(200) NOT NULL,
        [type] nvarchar(20) NOT NULL,
        [format] nvarchar(5) NOT NULL CONSTRAINT [DF_d9ea6bde472de21d6029d7ee4a2] DEFAULT 'xlsx',
        [storeIds] nvarchar(MAX) NOT NULL,
        [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_aa6605032a9336e06cba0cd924f] DEFAULT 'DAILY',
        [recipients] nvarchar(1000) NOT NULL CONSTRAINT [DF_2f45c000ae88c114a7e0825d700] DEFAULT '',
        [isActive] bit NOT NULL CONSTRAINT [DF_34298ee6c94b6a8b134f5227598] DEFAULT 1,
        [lastRunAt] datetime2 NULL,
        [lastFile] nvarchar(500) NULL,
        [createdById] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_1419c883d899e66ddf7647da181] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_603f9cdaaf4c1193d7399c1e79c] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.settings', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[settings] (
        [key] nvarchar(100) NOT NULL,
        [value] nvarchar(MAX) NULL,
        CONSTRAINT [PK_c8639b7626fa94ba8265628f214] PRIMARY KEY ([key])
    );
END
GO

IF OBJECT_ID(N'dbo.snapshots', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[snapshots] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [kind] nvarchar(20) NOT NULL CONSTRAINT [DF_b5805d9d9868370d165a2c8a066] DEFAULT 'PERIODIC',
        [filePath] nvarchar(400) NOT NULL,
        [sizeBytes] int NOT NULL CONSTRAINT [DF_a48f37d5320f1b01e656a566517] DEFAULT 0,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_af65248e79e9ae8032908f8473d] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_f5661b5fd4224d23e26a631986b] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.staff', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[staff] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [code] nvarchar(30) NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [designation] nvarchar(100) NOT NULL CONSTRAINT [DF_d09cd4b4f276a0b2702d461d6b1] DEFAULT '',
        [shiftStart] nvarchar(5) NOT NULL CONSTRAINT [DF_1f2dd1e99b44685f59207326f3a] DEFAULT '10:00',
        [shiftEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_d1c1540db8b188b926d8b7706e4] DEFAULT '19:00',
        [isActive] bit NOT NULL CONSTRAINT [DF_10ca985333d13146d061f22e184] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e1d1cbbb31e98e16625555fc037] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_e4ee98bb552756c180aec1e854a] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.storeops_events', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[storeops_events] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NULL,
        [type] nvarchar(30) NOT NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [details] nvarchar(1000) NULL,
        [snapshotId] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e302f87cf4128ec287db0c7d750] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_048b0a7c5a4fd2eca02034fbafe] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.tasks', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tasks] (
        [id] int IDENTITY(1,1) NOT NULL,
        [title] nvarchar(200) NOT NULL,
        [description] nvarchar(2000) NOT NULL CONSTRAINT [DF_c9f361efbefcdff99c1ccfd1a3f] DEFAULT '',
        [storeId] int NOT NULL,
        [zoneId] int NULL,
        [type] nvarchar(30) NOT NULL CONSTRAINT [DF_a43b29dfedb5fce6199328bba8c] DEFAULT 'GENERAL',
        [priority] nvarchar(10) NOT NULL CONSTRAINT [DF_bd213ab7fa55f02309c5f23bbc3] DEFAULT 'MEDIUM',
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_6086c8dafbae729a930c04d8651] DEFAULT 'TODO',
        [assigneeId] int NULL,
        [createdById] int NOT NULL,
        [dueAt] datetime2 NULL,
        [completedAt] datetime2 NULL,
        [verifiedAt] datetime2 NULL,
        [verifiedById] int NULL,
        [startAt] datetime2 NULL,
        [checklistAnswerId] int NULL,
        [proofUrl] nvarchar(500) NULL,
        [remark] nvarchar(2000) NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_10f8a3df60c9e7771cefba6c35b] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_955b728d4ffcea6f051a341946d] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_8d12ff38fcc62aaba2cab748772] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.tickets', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[tickets] (
        [id] int IDENTITY(1,1) NOT NULL,
        [number] nvarchar(20) NOT NULL CONSTRAINT [DF_78e08cc1101fc17f77c6f11b4c7] DEFAULT '',
        [title] nvarchar(200) NOT NULL,
        [description] nvarchar(4000) NOT NULL CONSTRAINT [DF_f84788deaf465fbcf65f6dc5d83] DEFAULT '',
        [storeId] int NOT NULL,
        [category] nvarchar(20) NOT NULL CONSTRAINT [DF_143c60f935aa86982b2074fadd2] DEFAULT 'OTHER',
        [priority] nvarchar(10) NOT NULL CONSTRAINT [DF_1cfb61a749963bfba02395e118a] DEFAULT 'MEDIUM',
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_12b901b34113688b47863685106] DEFAULT 'OPEN',
        [assigneeId] int NULL,
        [reporterId] int NOT NULL,
        [alertId] int NULL,
        [slaDueAt] datetime2 NOT NULL,
        [resolvedAt] datetime2 NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e5a32949aaaa731c7ec0dc89e97] DEFAULT SYSUTCDATETIME(),
        [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_8a5aef5ed4de9ae4c02321160a4] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_343bc942ae261cf7a1377f48fd0] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.ticket_comments', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ticket_comments] (
        [id] int IDENTITY(1,1) NOT NULL,
        [ticketId] int NOT NULL,
        [userId] int NOT NULL,
        [body] nvarchar(4000) NOT NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_2f0f4740214d1c081ea469882fc] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_811ed3b81dd8df6b9a92058d89c] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.user_stores', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[user_stores] (
        [userId] int NOT NULL,
        [storeId] int NOT NULL,
        CONSTRAINT [PK_46fc8dd09795472adbf4ee45035] PRIMARY KEY ([userId], [storeId])
    );
END
GO

IF OBJECT_ID(N'dbo.vendors', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[vendors] (
        [id] int IDENTITY(1,1) NOT NULL,
        [name] nvarchar(200) NOT NULL,
        [category] nvarchar(20) NOT NULL CONSTRAINT [DF_53b4faa79665b59d2d4040666df] DEFAULT 'OTHER',
        [contactName] nvarchar(150) NOT NULL CONSTRAINT [DF_cb17249bb94abf9c5995f2a46c6] DEFAULT '',
        [phone] nvarchar(30) NOT NULL CONSTRAINT [DF_67ab49bf11bb8ca309d54e5449f] DEFAULT '',
        [email] nvarchar(200) NOT NULL CONSTRAINT [DF_3fe1343dbf2a7d9b7be1c27725a] DEFAULT '',
        [isActive] bit NOT NULL CONSTRAINT [DF_4590a112edb2123d0d03c1f1b63] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_76788a9dff51ae78714794c1c08] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_9c956c9797edfae5c6ddacc4e6e] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.vendor_visits', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[vendor_visits] (
        [id] int IDENTITY(1,1) NOT NULL,
        [vendorId] int NOT NULL,
        [storeId] int NOT NULL,
        [purpose] nvarchar(500) NOT NULL CONSTRAINT [DF_a074fe71e9121c29ca217310904] DEFAULT '',
        [scheduledAt] datetime2 NOT NULL,
        [checkInAt] datetime2 NULL,
        [checkOutAt] datetime2 NULL,
        [status] nvarchar(20) NOT NULL CONSTRAINT [DF_dc12e32f429f1b0ba0ee8147d05] DEFAULT 'SCHEDULED',
        [rating] int NULL,
        [notes] nvarchar(2000) NULL,
        [createdById] int NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_1d7f4b4d8b205cd2379dba1c2f1] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_793b186b62a1a0d5f5bda732133] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.visitor_events', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[visitor_events] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [zoneId] int NULL,
        [type] nvarchar(12) NOT NULL,
        [ts] datetime2 NOT NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [trackId] nvarchar(64) NOT NULL,
        [visitorId] nvarchar(128) NOT NULL,
        [isStaff] bit NOT NULL CONSTRAINT [DF_bbe9fca43e47140917dae6ae426] DEFAULT 0,
        [groupId] nvarchar(64) NULL,
        [gender] nvarchar(1) NOT NULL CONSTRAINT [DF_85345ea21b7dc9ac44f06b88c48] DEFAULT 'U',
        [ageBand] nvarchar(5) NOT NULL CONSTRAINT [DF_d46b062689a70fc3904173733bd] DEFAULT 'U',
        [dwellSec] float NULL,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e0eb928822cfd1919be16a3e374] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_d5fb60829b2ee5232c64ff65530] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.visits', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[visits] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [visitorId] nvarchar(128) NOT NULL,
        [trackId] nvarchar(64) NOT NULL CONSTRAINT [DF_b5fe7a1e8927cc4ac128a9799e1] DEFAULT '',
        [entryTs] datetime2 NOT NULL,
        [exitTs] datetime2 NULL,
        [date] varchar(10) NOT NULL,
        [hour] int NOT NULL,
        [dwellSec] float NULL,
        [isStaff] bit NOT NULL CONSTRAINT [DF_24a028798b67828e8776d6f7901] DEFAULT 0,
        [groupId] nvarchar(64) NULL,
        [gender] nvarchar(1) NOT NULL CONSTRAINT [DF_a1c7d5f6de383c408576d1e7bbf] DEFAULT 'U',
        [ageBand] nvarchar(5) NOT NULL CONSTRAINT [DF_77a7954a962ed36468299da9192] DEFAULT 'U',
        [engaged] bit NOT NULL CONSTRAINT [DF_55242b71f4530aaeba18a5625c4] DEFAULT 0,
        [zoneEngaged] bit NOT NULL CONSTRAINT [DF_0b8d8bf92217111e00675161caf] DEFAULT 0,
        [bounced] bit NOT NULL CONSTRAINT [DF_612ad0adfeaa09ff88e19ca7323] DEFAULT 0,
        [isRepeat] bit NOT NULL CONSTRAINT [DF_2847831543d4cd121cde66a24d5] DEFAULT 0,
        [maxZoneDwellSec] float NOT NULL CONSTRAINT [DF_9199da0f79a0384aaafc8a6abf2] DEFAULT 0,
        [autoClosed] bit NOT NULL CONSTRAINT [DF_37e19d945bd5d4719d23b7b65cf] DEFAULT 0,
        CONSTRAINT [PK_0b0b322289a41015c6ea4e8bf30] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.zone_transitions', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[zone_transitions] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [date] varchar(10) NOT NULL,
        [fromZoneId] int NOT NULL,
        [toZoneId] int NOT NULL,
        [count] int NOT NULL CONSTRAINT [DF_4e44731c0ebaa497fd831db4e55] DEFAULT 0,
        CONSTRAINT [PK_dda7e7ada12908c4ea27f063c72] PRIMARY KEY ([id])
    );
END
GO

IF OBJECT_ID(N'dbo.zones', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[zones] (
        [id] int IDENTITY(1,1) NOT NULL,
        [storeId] int NOT NULL,
        [cameraId] int NOT NULL,
        [name] nvarchar(150) NOT NULL,
        [type] nvarchar(20) NOT NULL,
        [polygon] nvarchar(MAX) NOT NULL,
        [inDirection] nvarchar(10) NULL,
        [engagedDwellSec] int NOT NULL CONSTRAINT [DF_4f04f87caf1fa496ced5c2d5994] DEFAULT 30,
        [queueAlertLength] int NULL,
        [queueAlertWaitSec] int NULL,
        [referenceSnapshotId] int NULL,
        [isActive] bit NOT NULL CONSTRAINT [DF_b180effa2280f809c6b27b4d83f] DEFAULT 1,
        [createdAt] datetime2 NOT NULL CONSTRAINT [DF_d0c631cd057d54c64b985977ee6] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_880484a43ca311707b05895bd4a] PRIMARY KEY ([id])
    );
END
GO

/* ---------------------------------------------------------------- upgrade: add columns missing in an existing (v1) database */
IF COL_LENGTH(N'dbo.ai_detections', N'ruleId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [ruleId] int NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'type') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [type] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'storeId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'cameraId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'zoneId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [zoneId] int NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'ts') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'date') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'status') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [status] nvarchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'details') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [details] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'confidence') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [confidence] float NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'snapshotId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [snapshotId] int NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'reviewStatus') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [reviewStatus] nvarchar(20) NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'reviewedById') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [reviewedById] int NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'alertId') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [alertId] int NULL;
GO
IF COL_LENGTH(N'dbo.ai_detections', N'createdAt') IS NULL
    ALTER TABLE [dbo].[ai_detections] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_d6b50ff6624356dd85908f3b535] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'name') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'type') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [type] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'storeIds') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [storeIds] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'zoneIds') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [zoneIds] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'windowStart') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [windowStart] nvarchar(5) NOT NULL CONSTRAINT [DF_e918976c5105e98bb972bc33945] DEFAULT '00:00';
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'windowEnd') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [windowEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_d36499f050472da201179c81a34] DEFAULT '23:59';
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'daysOfWeek') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [daysOfWeek] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'params') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [params] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'severity') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [severity] nvarchar(10) NOT NULL CONSTRAINT [DF_f29df44e417c9a4855b72a61e9e] DEFAULT 'MEDIUM';
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'notifyChannels') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [notifyChannels] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'notifyEmails') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [notifyEmails] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'isActive') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [isActive] bit NOT NULL CONSTRAINT [DF_5bc14b4dfb925827465e2594f0a] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.ai_manager_rules', N'createdAt') IS NULL
    ALTER TABLE [dbo].[ai_manager_rules] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_53336bb0af2a7aba79c35a54bbb] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.regions', N'name') IS NULL
    ALTER TABLE [dbo].[regions] ADD [name] nvarchar(100) NOT NULL;
GO
IF COL_LENGTH(N'dbo.regions', N'createdAt') IS NULL
    ALTER TABLE [dbo].[regions] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_133912903ed8b6adc012151abe9] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.stores', N'code') IS NULL
    ALTER TABLE [dbo].[stores] ADD [code] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.stores', N'name') IS NULL
    ALTER TABLE [dbo].[stores] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.stores', N'regionId') IS NULL
    ALTER TABLE [dbo].[stores] ADD [regionId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.stores', N'city') IS NULL
    ALTER TABLE [dbo].[stores] ADD [city] nvarchar(100) NOT NULL CONSTRAINT [DF_9a8b1293e56097f615d488b2539] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.stores', N'address') IS NULL
    ALTER TABLE [dbo].[stores] ADD [address] nvarchar(400) NOT NULL CONSTRAINT [DF_8a421ad709f5775133c313e676a] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.stores', N'timezone') IS NULL
    ALTER TABLE [dbo].[stores] ADD [timezone] nvarchar(64) NOT NULL CONSTRAINT [DF_de09e43bdb6d22ff5d13d486ea2] DEFAULT 'Asia/Kolkata';
GO
IF COL_LENGTH(N'dbo.stores', N'openTime') IS NULL
    ALTER TABLE [dbo].[stores] ADD [openTime] nvarchar(5) NOT NULL CONSTRAINT [DF_8358dfd33d7838c0396656ff62d] DEFAULT '10:00';
GO
IF COL_LENGTH(N'dbo.stores', N'closeTime') IS NULL
    ALTER TABLE [dbo].[stores] ADD [closeTime] nvarchar(5) NOT NULL CONSTRAINT [DF_fd7dd81306d6904621cb47c7d06] DEFAULT '21:30';
GO
IF COL_LENGTH(N'dbo.stores', N'areaSqft') IS NULL
    ALTER TABLE [dbo].[stores] ADD [areaSqft] int NOT NULL CONSTRAINT [DF_30394761973493562d58e6ec69f] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.stores', N'format') IS NULL
    ALTER TABLE [dbo].[stores] ADD [format] nvarchar(20) NOT NULL CONSTRAINT [DF_75ca83f68cc09abf939fd57786f] DEFAULT 'HIGH_STREET';
GO
IF COL_LENGTH(N'dbo.stores', N'isActive') IS NULL
    ALTER TABLE [dbo].[stores] ADD [isActive] bit NOT NULL CONSTRAINT [DF_b8ad2583e5874246fc7bc885637] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.stores', N'latitude') IS NULL
    ALTER TABLE [dbo].[stores] ADD [latitude] float NULL;
GO
IF COL_LENGTH(N'dbo.stores', N'longitude') IS NULL
    ALTER TABLE [dbo].[stores] ADD [longitude] float NULL;
GO
IF COL_LENGTH(N'dbo.stores', N'createdAt') IS NULL
    ALTER TABLE [dbo].[stores] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_571707c9853a152317bebfd030f] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.alert_rules', N'name') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'storeId') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [storeId] int NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'metric') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [metric] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'threshold') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [threshold] float NOT NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'severity') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [severity] nvarchar(10) NOT NULL CONSTRAINT [DF_1943948aaeeb4cb3e180a7069f6] DEFAULT 'MEDIUM';
GO
IF COL_LENGTH(N'dbo.alert_rules', N'channels') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [channels] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'emails') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [emails] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'webhookUrl') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [webhookUrl] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'cooldownMin') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [cooldownMin] int NOT NULL CONSTRAINT [DF_4dc958a24f63f2fe51993be6e67] DEFAULT 30;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'autoTicket') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [autoTicket] bit NOT NULL CONSTRAINT [DF_02d709c47dcb004c5597f6d3273] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'isActive') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [isActive] bit NOT NULL CONSTRAINT [DF_582a7980ea588b57f3af6b7f152] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.alert_rules', N'createdAt') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_2ab7f79de08337adb58fdc48ae5] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.alerts', N'ruleId') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [ruleId] int NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'ruleName') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [ruleName] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'storeId') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'metric') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [metric] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'severity') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [severity] nvarchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'message') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [message] nvarchar(1000) NOT NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'value') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [value] float NOT NULL CONSTRAINT [DF_125f166e599612855ac0a32604c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.alerts', N'status') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_b63189bf8e5abf5b9188acca964] DEFAULT 'OPEN';
GO
IF COL_LENGTH(N'dbo.alerts', N'createdAt') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_8bb8f7c97396b99b57794c5999c] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.alerts', N'acknowledgedAt') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [acknowledgedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'acknowledgedById') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [acknowledgedById] int NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'resolvedAt') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [resolvedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'resolvedById') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [resolvedById] int NULL;
GO
IF COL_LENGTH(N'dbo.alerts', N'ticketId') IS NULL
    ALTER TABLE [dbo].[alerts] ADD [ticketId] int NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'userId') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [userId] int NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'userName') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [userName] nvarchar(150) NOT NULL CONSTRAINT [DF_f14cf382d49d8736772aa83bdd3] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.audit_logs', N'action') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [action] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'entity') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [entity] nvarchar(60) NOT NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'entityId') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [entityId] int NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'details') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [details] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.audit_logs', N'createdAt') IS NULL
    ALTER TABLE [dbo].[audit_logs] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_c69efb19bf127c97e6740ad5300] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'storeId') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'cameraId') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'status') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [status] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'startedAt') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [startedAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'endedAt') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [endedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.camera_status_log', N'reason') IS NULL
    ALTER TABLE [dbo].[camera_status_log] ADD [reason] nvarchar(300) NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'storeId') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'name') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'kind') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [kind] nvarchar(10) NOT NULL CONSTRAINT [DF_16a43064ec69a98ade449ab0552] DEFAULT 'DVR';
GO
IF COL_LENGTH(N'dbo.recorders', N'brand') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [brand] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'host') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [host] nvarchar(255) NOT NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'rtspPort') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [rtspPort] int NOT NULL CONSTRAINT [DF_7f51d4bb791890b1a5145ff3e1f] DEFAULT 554;
GO
IF COL_LENGTH(N'dbo.recorders', N'httpPort') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [httpPort] int NOT NULL CONSTRAINT [DF_69b3ce1c5a3fc2b04c8fb35c2d4] DEFAULT 80;
GO
IF COL_LENGTH(N'dbo.recorders', N'username') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [username] nvarchar(100) NOT NULL CONSTRAINT [DF_12fcd64f896015aac106c1abc77] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.recorders', N'passwordEnc') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [passwordEnc] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'channels') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [channels] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'stream') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [stream] nvarchar(4) NOT NULL CONSTRAINT [DF_b58eab7f5583709c1a9f37fdfbf] DEFAULT 'MAIN';
GO
IF COL_LENGTH(N'dbo.recorders', N'urlTemplate') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [urlTemplate] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'status') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [status] nvarchar(10) NOT NULL CONSTRAINT [DF_d19ee79a85e821773f8d584cdf1] DEFAULT 'UNKNOWN';
GO
IF COL_LENGTH(N'dbo.recorders', N'lastCheckedAt') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [lastCheckedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.recorders', N'createdAt') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_6d0799c5a43f11e10b6a076887e] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.recorders', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[recorders] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_4027c8f608802bd24003848b093] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.cameras', N'storeId') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'name') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'rtspUrl') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [rtspUrl] nvarchar(500) NOT NULL CONSTRAINT [DF_c47c504d7e5ec794bc6f1a203b4] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.cameras', N'type') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [type] nvarchar(20) NOT NULL CONSTRAINT [DF_0f7ef819fee302f779f9089a5d0] DEFAULT 'GENERAL';
GO
IF COL_LENGTH(N'dbo.cameras', N'status') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_dcf3a964d6fb0f584a80d51efb9] DEFAULT 'UNKNOWN';
GO
IF COL_LENGTH(N'dbo.cameras', N'lastHeartbeatAt') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [lastHeartbeatAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'isActive') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [isActive] bit NOT NULL CONSTRAINT [DF_139470fbdab0b25ec6bb3476815] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.cameras', N'fps') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [fps] float NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'recorderId') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [recorderId] int NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'channel') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [channel] int NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'streamProfile') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [streamProfile] nvarchar(4) NULL;
GO
IF COL_LENGTH(N'dbo.cameras', N'createdAt') IS NULL
    ALTER TABLE [dbo].[cameras] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f96791be5d31265c2bbbec5d238] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'name') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [name] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'description') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [description] nvarchar(1000) NOT NULL CONSTRAINT [DF_c985afbe3486cf14e5a83db98ce] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'category') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [category] nvarchar(30) NOT NULL CONSTRAINT [DF_a21fbd47c708849d061e62802aa] DEFAULT 'OTHER';
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'frequency') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_9220544d00f8b9cb0e19be729d0] DEFAULT 'ADHOC';
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'isActive') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [isActive] bit NOT NULL CONSTRAINT [DF_d1d8c0cc4077a594f3fa9dbe4c3] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'version') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [version] int NOT NULL CONSTRAINT [DF_2b67de7292b485213b610f91154] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'createdById') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [createdById] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'createdAt') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_9c6c15d43cf487bd36d5e13a89c] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.checklist_templates', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[checklist_templates] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_0cf1a0f0415705c7642aa8590c9] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.users', N'email') IS NULL
    ALTER TABLE [dbo].[users] ADD [email] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.users', N'name') IS NULL
    ALTER TABLE [dbo].[users] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.users', N'passwordHash') IS NULL
    ALTER TABLE [dbo].[users] ADD [passwordHash] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.users', N'role') IS NULL
    ALTER TABLE [dbo].[users] ADD [role] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.users', N'isActive') IS NULL
    ALTER TABLE [dbo].[users] ADD [isActive] bit NOT NULL CONSTRAINT [DF_409a0298fdd86a6495e23c25c66] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.users', N'createdAt') IS NULL
    ALTER TABLE [dbo].[users] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_204e9b624861ff4a5b268192101] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.users', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[users] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_0f5cbe00928ba4489cc7312573b] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'assignmentId') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [assignmentId] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'templateId') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [templateId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'storeId') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'submittedById') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [submittedById] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'submittedAt') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [submittedAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'date') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'score') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [score] float NOT NULL CONSTRAINT [DF_49e0b05bfa3c9b49ebccdc3c794] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'maxScore') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [maxScore] float NOT NULL CONSTRAINT [DF_3b022acc5c50dfef848df325d7c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'scorePct') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [scorePct] float NOT NULL CONSTRAINT [DF_aaf36d4f25a397d6ee96340268d] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'status') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_4122324cf4a3240bf4fc37f1d9d] DEFAULT 'SUBMITTED';
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'flags') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [flags] int NOT NULL CONSTRAINT [DF_d8c710dd5c13e3bdd0498b8673f] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'reviewerComment') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [reviewerComment] nvarchar(2000) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'reviewedById') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [reviewedById] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'reviewedAt') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [reviewedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'templateVersion') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [templateVersion] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'templateSnapshot') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [templateSnapshot] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_submissions', N'isLate') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD [isLate] bit NOT NULL CONSTRAINT [DF_be0e68f7854bb4a53244039a813] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'templateId') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [templateId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'section') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [section] nvarchar(150) NOT NULL CONSTRAINT [DF_7b994e64c3162c3642ee50c2df2] DEFAULT 'General';
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'text') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [text] nvarchar(1000) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'type') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [type] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'options') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [options] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'correctOptions') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [correctOptions] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'required') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [required] bit NOT NULL CONSTRAINT [DF_483e374eed53332f1d49fef8e5f] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'weight') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [weight] float NOT NULL CONSTRAINT [DF_38f19d5af2e490951b32c68e89b] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'requiresPhoto') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [requiresPhoto] bit NOT NULL CONSTRAINT [DF_141872affe51645d1cec3a14e4e] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'sortOrder') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [sortOrder] int NOT NULL CONSTRAINT [DF_985557758494ecd63df58b16bcb] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'minValue') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [minValue] float NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'maxValue') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [maxValue] float NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'referenceImageUrl') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [referenceImageUrl] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'aiCheck') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [aiCheck] nvarchar(20) NOT NULL CONSTRAINT [DF_e14766787b53969798e61652c11] DEFAULT 'NONE';
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'createTaskOnFail') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [createTaskOnFail] bit NOT NULL CONSTRAINT [DF_14859ed174b1cb1dc0da853ac61] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_questions', N'isActive') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD [isActive] bit NOT NULL CONSTRAINT [DF_93e9b4f3cf1dd37e3cbf697c2ad] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'submissionId') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [submissionId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'questionId') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [questionId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'value') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [value] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'photoUrl') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [photoUrl] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'remark') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [remark] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'score') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [score] float NOT NULL CONSTRAINT [DF_17362d6cb543d1e5dd8d59fb787] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'maxScore') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [maxScore] float NOT NULL CONSTRAINT [DF_62bf548960d8f00b77580666e42] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'redo') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [redo] bit NOT NULL CONSTRAINT [DF_acc51f1dd70d42b3fbcb9726265] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'aiResult') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [aiResult] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_answers', N'flagged') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD [flagged] bit NOT NULL CONSTRAINT [DF_cd58882e8b1c4c0c1dc9d5bf6ab] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'templateId') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [templateId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'storeId') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'assigneeId') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [assigneeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'assignedById') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [assignedById] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'dueDate') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [dueDate] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'status') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_82e7b8e8c0032247fcc5da4ea99] DEFAULT 'PENDING';
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'submissionId') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [submissionId] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'dueAt') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [dueAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'windowStart') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [windowStart] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'scheduleId') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [scheduleId] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'draftAnswers') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [draftAnswers] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'remindedAt') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [remindedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.checklist_assignments', N'createdAt') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_ecad556308c738ed37fc8857209] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'templateId') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [templateId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'storeIds') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [storeIds] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'assigneeId') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [assigneeId] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'frequency') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_74f3f976048ef68b2316d872a99] DEFAULT 'DAILY';
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'repeatEvery') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [repeatEvery] int NOT NULL CONSTRAINT [DF_b07affa8a1fe4b467c402539cc0] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'daysOfWeek') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [daysOfWeek] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'dayOfMonth') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [dayOfMonth] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'windowStart') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [windowStart] nvarchar(5) NOT NULL CONSTRAINT [DF_f8ceb1ea9b264d7cc7253ec360d] DEFAULT '09:00';
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'windowEnd') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [windowEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_83a68f5714aaa7e7d8aea3fcc2a] DEFAULT '18:00';
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'startDate') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [startDate] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'endDate') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [endDate] varchar(10) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'reminderMinutesBefore') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [reminderMinutesBefore] int NOT NULL CONSTRAINT [DF_65f921d57ae8537781a8946c382] DEFAULT 60;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'isActive') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [isActive] bit NOT NULL CONSTRAINT [DF_18bfc5cd25cc98d4bb0835a96c2] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'lastGeneratedDate') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [lastGeneratedDate] varchar(10) NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'createdById') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [createdById] int NULL;
GO
IF COL_LENGTH(N'dbo.checklist_schedules', N'createdAt') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_ec25496a81982da5a3a2da7eab6] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'storeId') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'host') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [host] nvarchar(255) NOT NULL;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'rtspPort') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [rtspPort] int NOT NULL CONSTRAINT [DF_6032e0dfcd5991a4911b27931c3] DEFAULT 554;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'httpPort') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [httpPort] int NULL;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'brandGuess') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [brandGuess] nvarchar(20) NULL;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'onvif') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [onvif] bit NOT NULL CONSTRAINT [DF_5c749a1326e519e2ccbf7da2764] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.discovered_devices', N'seenAt') IS NULL
    ALTER TABLE [dbo].[discovered_devices] ADD [seenAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'title') IS NULL
    ALTER TABLE [dbo].[documents] ADD [title] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'category') IS NULL
    ALTER TABLE [dbo].[documents] ADD [category] nvarchar(20) NOT NULL CONSTRAINT [DF_b20c1ae2c7098e9a822f15aa6fc] DEFAULT 'OTHER';
GO
IF COL_LENGTH(N'dbo.documents', N'storeId') IS NULL
    ALTER TABLE [dbo].[documents] ADD [storeId] int NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'fileName') IS NULL
    ALTER TABLE [dbo].[documents] ADD [fileName] nvarchar(260) NOT NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'storedName') IS NULL
    ALTER TABLE [dbo].[documents] ADD [storedName] nvarchar(300) NOT NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'mimeType') IS NULL
    ALTER TABLE [dbo].[documents] ADD [mimeType] nvarchar(120) NOT NULL CONSTRAINT [DF_9f16120de147269a69e69ef5938] DEFAULT 'application/octet-stream';
GO
IF COL_LENGTH(N'dbo.documents', N'size') IS NULL
    ALTER TABLE [dbo].[documents] ADD [size] int NOT NULL CONSTRAINT [DF_c00ec23d524c9d104ef435ccb89] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.documents', N'uploadedById') IS NULL
    ALTER TABLE [dbo].[documents] ADD [uploadedById] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.documents', N'createdAt') IS NULL
    ALTER TABLE [dbo].[documents] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f8cc10f6d16ee343bbf23b829ed] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.edge_devices', N'storeId') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'name') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'apiKeyHash') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [apiKeyHash] nvarchar(64) NOT NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'apiKeyPrefix') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [apiKeyPrefix] nvarchar(12) NOT NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'version') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [version] nvarchar(50) NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'lastSeenAt') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [lastSeenAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.edge_devices', N'createdAt') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_a039e104e1a4236e4046c8861a0] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'storeId') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'cameraId') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'date') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'hour') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'width') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [width] int NOT NULL CONSTRAINT [DF_4f010a03393ad48b1ee53f68fe9] DEFAULT 32;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'height') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [height] int NOT NULL CONSTRAINT [DF_fcef925118ae4b48461a0030270] DEFAULT 18;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'grid') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [grid] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'samples') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [samples] int NOT NULL CONSTRAINT [DF_6955790935bb7598eb84d68ac8a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.heatmap_frames', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[heatmap_frames] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_ef84e6bcbcf3e6345b3c4a6350e] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'storeId') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'date') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'hour') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'footfallIn') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [footfallIn] int NOT NULL CONSTRAINT [DF_cd6a67043aad4cf09a80814ff8a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'footfallOut') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [footfallOut] int NOT NULL CONSTRAINT [DF_cfed1f0cf1f6fe126133f65ef52] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'uniqueVisitors') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [uniqueVisitors] int NOT NULL CONSTRAINT [DF_1da284d9e468dae9387bffc3963] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'staffEntries') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [staffEntries] int NOT NULL CONSTRAINT [DF_541de23a921fe0c7550d5083c9e] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'individuals') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [individuals] int NOT NULL CONSTRAINT [DF_56347b2ff245fdad82fcefe2a46] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'groups') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [groups] int NOT NULL CONSTRAINT [DF_89ea82fdd23ec0574b61f5e69ed] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'billableEntities') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [billableEntities] int NOT NULL CONSTRAINT [DF_db7767ddd55af67a55b3d064144] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'engaged') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [engaged] int NOT NULL CONSTRAINT [DF_e1d0ad1eddf82ff596f9320f097] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'engagedEntities') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [engagedEntities] int NOT NULL CONSTRAINT [DF_f9aad7870535e585d4aea3bf547] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'bounced') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [bounced] int NOT NULL CONSTRAINT [DF_e6548efd2e84a4a6a318cdc6cbb] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'repeatVisitors') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [repeatVisitors] int NOT NULL CONSTRAINT [DF_b7c12b9de6be7a677ddd6e662e0] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male] int NOT NULL CONSTRAINT [DF_fd80a44e318164792c66af452f9] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female] int NOT NULL CONSTRAINT [DF_1f5fb5a4d47f8f2ddcea6c3600a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'genderUnknown') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [genderUnknown] int NOT NULL CONSTRAINT [DF_5788051b980fddc3f67f25fca29] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_0_17') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_0_17] int NOT NULL CONSTRAINT [DF_65438c4c3ffeacdc61b9bea5ea5] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_18_24') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_18_24] int NOT NULL CONSTRAINT [DF_a6fd71c8d7a32965bd3af131b98] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_25_34') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_25_34] int NOT NULL CONSTRAINT [DF_445f4d574e55b9993fe1916046f] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_35_44') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_35_44] int NOT NULL CONSTRAINT [DF_449b001c3fefa171911afde88c0] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_45_54') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_45_54] int NOT NULL CONSTRAINT [DF_50e60ed075ca9b5d756e90f39a5] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'age_55_plus') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [age_55_plus] int NOT NULL CONSTRAINT [DF_2de1dc934f75879614b121120a7] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'ageUnknown') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [ageUnknown] int NOT NULL CONSTRAINT [DF_fed63826f74c0570361bbeec579] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_0_17') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_0_17] int NOT NULL CONSTRAINT [DF_1aab98049c07aa0ec5a2f798c5c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_18_24') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_18_24] int NOT NULL CONSTRAINT [DF_bb53cd4778cf69321a7545565bd] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_25_34') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_25_34] int NOT NULL CONSTRAINT [DF_5a891138bb68c8e60616c98417b] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_35_44') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_35_44] int NOT NULL CONSTRAINT [DF_59989c71119ca4fce5b6ee56a62] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_45_54') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_45_54] int NOT NULL CONSTRAINT [DF_6dd12773e4d0724b8780fe5ebce] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'male_55_plus') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [male_55_plus] int NOT NULL CONSTRAINT [DF_de1eae0b6ebe22e700931eaf064] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_0_17') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_0_17] int NOT NULL CONSTRAINT [DF_838a3df2e7d17bb1475c636d08b] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_18_24') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_18_24] int NOT NULL CONSTRAINT [DF_8a40f774a0b9b1331a701f34cdd] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_25_34') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_25_34] int NOT NULL CONSTRAINT [DF_bdc0e2d3359ace4c87a23f0198e] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_35_44') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_35_44] int NOT NULL CONSTRAINT [DF_e3e65ae6aa70b6550fe15c1990c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_45_54') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_45_54] int NOT NULL CONSTRAINT [DF_f9c53fb69c5ba4d4c17f54dbb3a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'female_55_plus') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [female_55_plus] int NOT NULL CONSTRAINT [DF_75a298f75d267e2b82f07bea968] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'totalDwellSec') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [totalDwellSec] float NOT NULL CONSTRAINT [DF_4a5bfa5732a4351d03ed2aa2aa9] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'dwellCount') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [dwellCount] int NOT NULL CONSTRAINT [DF_6c49270a1b1b464c0d1bc7562bc] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'transactions') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [transactions] int NOT NULL CONSTRAINT [DF_437a31d0990bd0d337c1e6286e5] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'revenue') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [revenue] decimal(12,2) NOT NULL CONSTRAINT [DF_5903b1980645a9bf59d3e8a06b7] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'itemsSold') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [itemsSold] int NOT NULL CONSTRAINT [DF_11f31730164ffa3118520bde8e5] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'avgQueueLength') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [avgQueueLength] float NOT NULL CONSTRAINT [DF_2ef090f43d49766cdcf13496918] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'maxQueueLength') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [maxQueueLength] int NOT NULL CONSTRAINT [DF_864e339d3c7fc4256a7446b75b8] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'avgWaitSec') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [avgWaitSec] float NOT NULL CONSTRAINT [DF_4b23171bfb2f5c3d455cb674b9a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'maxWaitSec') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [maxWaitSec] float NOT NULL CONSTRAINT [DF_050b31e5de5473ca2983782b7f2] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'queueSamples') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [queueSamples] int NOT NULL CONSTRAINT [DF_ea3b529118da6cd9ff11592f127] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'queueBreaches') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [queueBreaches] int NOT NULL CONSTRAINT [DF_e2f8b7a88d5917217b687fc4f4a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'unattendedSec') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [unattendedSec] float NOT NULL CONSTRAINT [DF_90a7fb4a4299e47b1f3b3c7b7e9] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'staffPresentAvg') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [staffPresentAvg] float NOT NULL CONSTRAINT [DF_6862d66a96333d47fdcf551a3f7] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_store_metrics', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[hourly_store_metrics] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_16bc50bde814c7855a33f7b0d95] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'storeId') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'zoneId') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [zoneId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'date') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'hour') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'visits') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [visits] int NOT NULL CONSTRAINT [DF_26b6bd1d23d3c45a0e5fcc25c84] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'uniqueVisitors') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [uniqueVisitors] int NOT NULL CONSTRAINT [DF_41461661be4f4cad75db38cc3e7] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'totalDwellSec') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [totalDwellSec] float NOT NULL CONSTRAINT [DF_da04e0656b7336ab72524aa12a6] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'dwellCount') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [dwellCount] int NOT NULL CONSTRAINT [DF_298df369880a478ba07e48c24d0] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'engaged') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [engaged] int NOT NULL CONSTRAINT [DF_b7046694dc013ce0618342109c2] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'male') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [male] int NOT NULL CONSTRAINT [DF_fa3c0e026e455f6d4e98fedd3ee] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'female') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [female] int NOT NULL CONSTRAINT [DF_1a8761ef3489dcd4ea274ffe381] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'bounced') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [bounced] int NOT NULL CONSTRAINT [DF_8600d17e8d9d97cab564a3a9ec1] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_0_17') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_0_17] int NOT NULL CONSTRAINT [DF_c2422d54357f5544f9585b72cd6] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_18_24') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_18_24] int NOT NULL CONSTRAINT [DF_d7fc918c1e1b152c59b97d4b24c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_25_34') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_25_34] int NOT NULL CONSTRAINT [DF_eaa9975657bfaefc14b837bf301] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_35_44') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_35_44] int NOT NULL CONSTRAINT [DF_5905346b237fcfea3927f506752] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_45_54') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_45_54] int NOT NULL CONSTRAINT [DF_e90f5d42c18d7eebf15991cea3c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'age_55_plus') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [age_55_plus] int NOT NULL CONSTRAINT [DF_0443c260d67aa0483325b6ad78c] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'queueSamples') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [queueSamples] int NOT NULL CONSTRAINT [DF_c18e198a6dcd80aafb63dcff164] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'avgQueueLength') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [avgQueueLength] float NOT NULL CONSTRAINT [DF_5ec5d16984a04797cb1be23004a] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'maxQueueLength') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [maxQueueLength] int NOT NULL CONSTRAINT [DF_b8d8696ca2d9aa03b6cc65777fc] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'avgWaitSec') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [avgWaitSec] float NOT NULL CONSTRAINT [DF_36db8f2df450075eb9fb09960d6] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'maxWaitSec') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [maxWaitSec] float NOT NULL CONSTRAINT [DF_dc0db5daa8dc6185e987d7bd40e] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'queueBreaches') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [queueBreaches] int NOT NULL CONSTRAINT [DF_216195b744ba72d3ded51de4a12] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'unattendedSec') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [unattendedSec] float NOT NULL CONSTRAINT [DF_16c1855731cb94135cf8fb9de67] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.hourly_zone_metrics', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[hourly_zone_metrics] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_8cc1943efc1bc36d485a8b1f390] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.ingest_batches', N'storeId') IS NULL
    ALTER TABLE [dbo].[ingest_batches] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.ingest_batches', N'kind') IS NULL
    ALTER TABLE [dbo].[ingest_batches] ADD [kind] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ingest_batches', N'batchId') IS NULL
    ALTER TABLE [dbo].[ingest_batches] ADD [batchId] nvarchar(64) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ingest_batches', N'response') IS NULL
    ALTER TABLE [dbo].[ingest_batches] ADD [response] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.ingest_batches', N'createdAt') IS NULL
    ALTER TABLE [dbo].[ingest_batches] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_3a21a7c7520a0fb98ef91d843c7] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.notifications', N'userId') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [userId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.notifications', N'title') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [title] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.notifications', N'body') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [body] nvarchar(1000) NOT NULL CONSTRAINT [DF_e26a5e8baf69121e8bea1ada5d4] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.notifications', N'link') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [link] nvarchar(300) NULL;
GO
IF COL_LENGTH(N'dbo.notifications', N'isRead') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [isRead] bit NOT NULL CONSTRAINT [DF_8ba28344602d583583b9ea1a500] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.notifications', N'createdAt') IS NULL
    ALTER TABLE [dbo].[notifications] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_831a5a06f879fb0bebf89658713] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'storeId') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'billNo') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [billNo] nvarchar(60) NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'ts') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'date') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'hour') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'amount') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [amount] decimal(12,2) NOT NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'itemsCount') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [itemsCount] int NOT NULL CONSTRAINT [DF_f343ac89aa3f09a09040a1ac1d3] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'staffCode') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [staffCode] nvarchar(30) NULL;
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'source') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [source] nvarchar(10) NOT NULL CONSTRAINT [DF_61bf90510d19e1b1098850f920e] DEFAULT 'API';
GO
IF COL_LENGTH(N'dbo.pos_transactions', N'createdAt') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_345a34e3d48e2a337baf0c4129f] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.probes', N'storeId') IS NULL
    ALTER TABLE [dbo].[probes] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'cameraId') IS NULL
    ALTER TABLE [dbo].[probes] ADD [cameraId] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'recorderId') IS NULL
    ALTER TABLE [dbo].[probes] ADD [recorderId] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'channel') IS NULL
    ALTER TABLE [dbo].[probes] ADD [channel] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'streamProfile') IS NULL
    ALTER TABLE [dbo].[probes] ADD [streamProfile] nvarchar(4) NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'status') IS NULL
    ALTER TABLE [dbo].[probes] ADD [status] nvarchar(10) NOT NULL CONSTRAINT [DF_74faa2491604c3fe096a88e4421] DEFAULT 'PENDING';
GO
IF COL_LENGTH(N'dbo.probes', N'requestedAt') IS NULL
    ALTER TABLE [dbo].[probes] ADD [requestedAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'claimedAt') IS NULL
    ALTER TABLE [dbo].[probes] ADD [claimedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'completedAt') IS NULL
    ALTER TABLE [dbo].[probes] ADD [completedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'width') IS NULL
    ALTER TABLE [dbo].[probes] ADD [width] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'height') IS NULL
    ALTER TABLE [dbo].[probes] ADD [height] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'fps') IS NULL
    ALTER TABLE [dbo].[probes] ADD [fps] float NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'codec') IS NULL
    ALTER TABLE [dbo].[probes] ADD [codec] nvarchar(30) NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'latencyMs') IS NULL
    ALTER TABLE [dbo].[probes] ADD [latencyMs] int NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'error') IS NULL
    ALTER TABLE [dbo].[probes] ADD [error] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'errorCode') IS NULL
    ALTER TABLE [dbo].[probes] ADD [errorCode] nvarchar(20) NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'snapshotPath') IS NULL
    ALTER TABLE [dbo].[probes] ADD [snapshotPath] nvarchar(300) NULL;
GO
IF COL_LENGTH(N'dbo.probes', N'requestedById') IS NULL
    ALTER TABLE [dbo].[probes] ADD [requestedById] int NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'storeId') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'zoneId') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [zoneId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'ts') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'date') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'hour') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'queueLength') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [queueLength] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'avgWaitSec') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [avgWaitSec] float NOT NULL;
GO
IF COL_LENGTH(N'dbo.queue_snapshots', N'counterStaffed') IS NULL
    ALTER TABLE [dbo].[queue_snapshots] ADD [counterStaffed] bit NOT NULL CONSTRAINT [DF_1cd01e92d6f0b27aa68cd6942c8] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.recaps', N'storeId') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.recaps', N'date') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.recaps', N'status') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [status] nvarchar(10) NOT NULL CONSTRAINT [DF_ef4f9d41a7844cff29e4b410bd0] DEFAULT 'PENDING';
GO
IF COL_LENGTH(N'dbo.recaps', N'filePath') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [filePath] nvarchar(400) NULL;
GO
IF COL_LENGTH(N'dbo.recaps', N'durationSec') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [durationSec] float NOT NULL CONSTRAINT [DF_71f3261f224831e40ac099f11cd] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.recaps', N'frameCount') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [frameCount] int NOT NULL CONSTRAINT [DF_cffbcb059f48ba67b9675b96acb] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.recaps', N'error') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [error] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.recaps', N'createdAt') IS NULL
    ALTER TABLE [dbo].[recaps] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_f506b11c85b01b1e2f06f14d5a9] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.report_schedules', N'name') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [name] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'type') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [type] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'format') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [format] nvarchar(5) NOT NULL CONSTRAINT [DF_d9ea6bde472de21d6029d7ee4a2] DEFAULT 'xlsx';
GO
IF COL_LENGTH(N'dbo.report_schedules', N'storeIds') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [storeIds] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'frequency') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [frequency] nvarchar(10) NOT NULL CONSTRAINT [DF_aa6605032a9336e06cba0cd924f] DEFAULT 'DAILY';
GO
IF COL_LENGTH(N'dbo.report_schedules', N'recipients') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [recipients] nvarchar(1000) NOT NULL CONSTRAINT [DF_2f45c000ae88c114a7e0825d700] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.report_schedules', N'isActive') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [isActive] bit NOT NULL CONSTRAINT [DF_34298ee6c94b6a8b134f5227598] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'lastRunAt') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [lastRunAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'lastFile') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [lastFile] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'createdById') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [createdById] int NULL;
GO
IF COL_LENGTH(N'dbo.report_schedules', N'createdAt') IS NULL
    ALTER TABLE [dbo].[report_schedules] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_1419c883d899e66ddf7647da181] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.settings', N'value') IS NULL
    ALTER TABLE [dbo].[settings] ADD [value] nvarchar(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'storeId') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'cameraId') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'ts') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'date') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'kind') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [kind] nvarchar(20) NOT NULL CONSTRAINT [DF_b5805d9d9868370d165a2c8a066] DEFAULT 'PERIODIC';
GO
IF COL_LENGTH(N'dbo.snapshots', N'filePath') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [filePath] nvarchar(400) NOT NULL;
GO
IF COL_LENGTH(N'dbo.snapshots', N'sizeBytes') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [sizeBytes] int NOT NULL CONSTRAINT [DF_a48f37d5320f1b01e656a566517] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.snapshots', N'createdAt') IS NULL
    ALTER TABLE [dbo].[snapshots] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_af65248e79e9ae8032908f8473d] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.staff', N'storeId') IS NULL
    ALTER TABLE [dbo].[staff] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.staff', N'code') IS NULL
    ALTER TABLE [dbo].[staff] ADD [code] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.staff', N'name') IS NULL
    ALTER TABLE [dbo].[staff] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.staff', N'designation') IS NULL
    ALTER TABLE [dbo].[staff] ADD [designation] nvarchar(100) NOT NULL CONSTRAINT [DF_d09cd4b4f276a0b2702d461d6b1] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.staff', N'shiftStart') IS NULL
    ALTER TABLE [dbo].[staff] ADD [shiftStart] nvarchar(5) NOT NULL CONSTRAINT [DF_1f2dd1e99b44685f59207326f3a] DEFAULT '10:00';
GO
IF COL_LENGTH(N'dbo.staff', N'shiftEnd') IS NULL
    ALTER TABLE [dbo].[staff] ADD [shiftEnd] nvarchar(5) NOT NULL CONSTRAINT [DF_d1c1540db8b188b926d8b7706e4] DEFAULT '19:00';
GO
IF COL_LENGTH(N'dbo.staff', N'isActive') IS NULL
    ALTER TABLE [dbo].[staff] ADD [isActive] bit NOT NULL CONSTRAINT [DF_10ca985333d13146d061f22e184] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.staff', N'createdAt') IS NULL
    ALTER TABLE [dbo].[staff] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e1d1cbbb31e98e16625555fc037] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.storeops_events', N'storeId') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'cameraId') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [cameraId] int NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'type') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [type] nvarchar(30) NOT NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'ts') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'date') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'hour') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'details') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [details] nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'snapshotId') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [snapshotId] int NULL;
GO
IF COL_LENGTH(N'dbo.storeops_events', N'createdAt') IS NULL
    ALTER TABLE [dbo].[storeops_events] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e302f87cf4128ec287db0c7d750] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.tasks', N'title') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [title] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'description') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [description] nvarchar(2000) NOT NULL CONSTRAINT [DF_c9f361efbefcdff99c1ccfd1a3f] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.tasks', N'storeId') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'zoneId') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [zoneId] int NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'type') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [type] nvarchar(30) NOT NULL CONSTRAINT [DF_a43b29dfedb5fce6199328bba8c] DEFAULT 'GENERAL';
GO
IF COL_LENGTH(N'dbo.tasks', N'priority') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [priority] nvarchar(10) NOT NULL CONSTRAINT [DF_bd213ab7fa55f02309c5f23bbc3] DEFAULT 'MEDIUM';
GO
IF COL_LENGTH(N'dbo.tasks', N'status') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_6086c8dafbae729a930c04d8651] DEFAULT 'TODO';
GO
IF COL_LENGTH(N'dbo.tasks', N'assigneeId') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [assigneeId] int NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'createdById') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [createdById] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'dueAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [dueAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'completedAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [completedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'verifiedAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [verifiedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'verifiedById') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [verifiedById] int NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'startAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [startAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'checklistAnswerId') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [checklistAnswerId] int NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'proofUrl') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [proofUrl] nvarchar(500) NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'remark') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [remark] nvarchar(2000) NULL;
GO
IF COL_LENGTH(N'dbo.tasks', N'createdAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_10f8a3df60c9e7771cefba6c35b] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.tasks', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[tasks] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_955b728d4ffcea6f051a341946d] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.tickets', N'number') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [number] nvarchar(20) NOT NULL CONSTRAINT [DF_78e08cc1101fc17f77c6f11b4c7] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.tickets', N'title') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [title] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'description') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [description] nvarchar(4000) NOT NULL CONSTRAINT [DF_f84788deaf465fbcf65f6dc5d83] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.tickets', N'storeId') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'category') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [category] nvarchar(20) NOT NULL CONSTRAINT [DF_143c60f935aa86982b2074fadd2] DEFAULT 'OTHER';
GO
IF COL_LENGTH(N'dbo.tickets', N'priority') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [priority] nvarchar(10) NOT NULL CONSTRAINT [DF_1cfb61a749963bfba02395e118a] DEFAULT 'MEDIUM';
GO
IF COL_LENGTH(N'dbo.tickets', N'status') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_12b901b34113688b47863685106] DEFAULT 'OPEN';
GO
IF COL_LENGTH(N'dbo.tickets', N'assigneeId') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [assigneeId] int NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'reporterId') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [reporterId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'alertId') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [alertId] int NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'slaDueAt') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [slaDueAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'resolvedAt') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [resolvedAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.tickets', N'createdAt') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e5a32949aaaa731c7ec0dc89e97] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.tickets', N'updatedAt') IS NULL
    ALTER TABLE [dbo].[tickets] ADD [updatedAt] datetime2 NOT NULL CONSTRAINT [DF_8a5aef5ed4de9ae4c02321160a4] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.ticket_comments', N'ticketId') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD [ticketId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.ticket_comments', N'userId') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD [userId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.ticket_comments', N'body') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD [body] nvarchar(4000) NOT NULL;
GO
IF COL_LENGTH(N'dbo.ticket_comments', N'createdAt') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_2f0f4740214d1c081ea469882fc] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.vendors', N'name') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [name] nvarchar(200) NOT NULL;
GO
IF COL_LENGTH(N'dbo.vendors', N'category') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [category] nvarchar(20) NOT NULL CONSTRAINT [DF_53b4faa79665b59d2d4040666df] DEFAULT 'OTHER';
GO
IF COL_LENGTH(N'dbo.vendors', N'contactName') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [contactName] nvarchar(150) NOT NULL CONSTRAINT [DF_cb17249bb94abf9c5995f2a46c6] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.vendors', N'phone') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [phone] nvarchar(30) NOT NULL CONSTRAINT [DF_67ab49bf11bb8ca309d54e5449f] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.vendors', N'email') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [email] nvarchar(200) NOT NULL CONSTRAINT [DF_3fe1343dbf2a7d9b7be1c27725a] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.vendors', N'isActive') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [isActive] bit NOT NULL CONSTRAINT [DF_4590a112edb2123d0d03c1f1b63] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.vendors', N'createdAt') IS NULL
    ALTER TABLE [dbo].[vendors] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_76788a9dff51ae78714794c1c08] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'vendorId') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [vendorId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'storeId') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'purpose') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [purpose] nvarchar(500) NOT NULL CONSTRAINT [DF_a074fe71e9121c29ca217310904] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'scheduledAt') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [scheduledAt] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'checkInAt') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [checkInAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'checkOutAt') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [checkOutAt] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'status') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [status] nvarchar(20) NOT NULL CONSTRAINT [DF_dc12e32f429f1b0ba0ee8147d05] DEFAULT 'SCHEDULED';
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'rating') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [rating] int NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'notes') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [notes] nvarchar(2000) NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'createdById') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [createdById] int NULL;
GO
IF COL_LENGTH(N'dbo.vendor_visits', N'createdAt') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_1d7f4b4d8b205cd2379dba1c2f1] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.visitor_events', N'storeId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'cameraId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'zoneId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [zoneId] int NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'type') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [type] nvarchar(12) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'ts') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [ts] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'date') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'hour') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'trackId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [trackId] nvarchar(64) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'visitorId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [visitorId] nvarchar(128) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'isStaff') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [isStaff] bit NOT NULL CONSTRAINT [DF_bbe9fca43e47140917dae6ae426] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'groupId') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [groupId] nvarchar(64) NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'gender') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [gender] nvarchar(1) NOT NULL CONSTRAINT [DF_85345ea21b7dc9ac44f06b88c48] DEFAULT 'U';
GO
IF COL_LENGTH(N'dbo.visitor_events', N'ageBand') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [ageBand] nvarchar(5) NOT NULL CONSTRAINT [DF_d46b062689a70fc3904173733bd] DEFAULT 'U';
GO
IF COL_LENGTH(N'dbo.visitor_events', N'dwellSec') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [dwellSec] float NULL;
GO
IF COL_LENGTH(N'dbo.visitor_events', N'createdAt') IS NULL
    ALTER TABLE [dbo].[visitor_events] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_e0eb928822cfd1919be16a3e374] DEFAULT SYSUTCDATETIME();
GO
IF COL_LENGTH(N'dbo.visits', N'storeId') IS NULL
    ALTER TABLE [dbo].[visits] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'visitorId') IS NULL
    ALTER TABLE [dbo].[visits] ADD [visitorId] nvarchar(128) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'trackId') IS NULL
    ALTER TABLE [dbo].[visits] ADD [trackId] nvarchar(64) NOT NULL CONSTRAINT [DF_b5fe7a1e8927cc4ac128a9799e1] DEFAULT '';
GO
IF COL_LENGTH(N'dbo.visits', N'entryTs') IS NULL
    ALTER TABLE [dbo].[visits] ADD [entryTs] datetime2 NOT NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'exitTs') IS NULL
    ALTER TABLE [dbo].[visits] ADD [exitTs] datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'date') IS NULL
    ALTER TABLE [dbo].[visits] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'hour') IS NULL
    ALTER TABLE [dbo].[visits] ADD [hour] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'dwellSec') IS NULL
    ALTER TABLE [dbo].[visits] ADD [dwellSec] float NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'isStaff') IS NULL
    ALTER TABLE [dbo].[visits] ADD [isStaff] bit NOT NULL CONSTRAINT [DF_24a028798b67828e8776d6f7901] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'groupId') IS NULL
    ALTER TABLE [dbo].[visits] ADD [groupId] nvarchar(64) NULL;
GO
IF COL_LENGTH(N'dbo.visits', N'gender') IS NULL
    ALTER TABLE [dbo].[visits] ADD [gender] nvarchar(1) NOT NULL CONSTRAINT [DF_a1c7d5f6de383c408576d1e7bbf] DEFAULT 'U';
GO
IF COL_LENGTH(N'dbo.visits', N'ageBand') IS NULL
    ALTER TABLE [dbo].[visits] ADD [ageBand] nvarchar(5) NOT NULL CONSTRAINT [DF_77a7954a962ed36468299da9192] DEFAULT 'U';
GO
IF COL_LENGTH(N'dbo.visits', N'engaged') IS NULL
    ALTER TABLE [dbo].[visits] ADD [engaged] bit NOT NULL CONSTRAINT [DF_55242b71f4530aaeba18a5625c4] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'zoneEngaged') IS NULL
    ALTER TABLE [dbo].[visits] ADD [zoneEngaged] bit NOT NULL CONSTRAINT [DF_0b8d8bf92217111e00675161caf] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'bounced') IS NULL
    ALTER TABLE [dbo].[visits] ADD [bounced] bit NOT NULL CONSTRAINT [DF_612ad0adfeaa09ff88e19ca7323] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'isRepeat') IS NULL
    ALTER TABLE [dbo].[visits] ADD [isRepeat] bit NOT NULL CONSTRAINT [DF_2847831543d4cd121cde66a24d5] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'maxZoneDwellSec') IS NULL
    ALTER TABLE [dbo].[visits] ADD [maxZoneDwellSec] float NOT NULL CONSTRAINT [DF_9199da0f79a0384aaafc8a6abf2] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.visits', N'autoClosed') IS NULL
    ALTER TABLE [dbo].[visits] ADD [autoClosed] bit NOT NULL CONSTRAINT [DF_37e19d945bd5d4719d23b7b65cf] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.zone_transitions', N'storeId') IS NULL
    ALTER TABLE [dbo].[zone_transitions] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.zone_transitions', N'date') IS NULL
    ALTER TABLE [dbo].[zone_transitions] ADD [date] varchar(10) NOT NULL;
GO
IF COL_LENGTH(N'dbo.zone_transitions', N'fromZoneId') IS NULL
    ALTER TABLE [dbo].[zone_transitions] ADD [fromZoneId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.zone_transitions', N'toZoneId') IS NULL
    ALTER TABLE [dbo].[zone_transitions] ADD [toZoneId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.zone_transitions', N'count') IS NULL
    ALTER TABLE [dbo].[zone_transitions] ADD [count] int NOT NULL CONSTRAINT [DF_4e44731c0ebaa497fd831db4e55] DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.zones', N'storeId') IS NULL
    ALTER TABLE [dbo].[zones] ADD [storeId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'cameraId') IS NULL
    ALTER TABLE [dbo].[zones] ADD [cameraId] int NOT NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'name') IS NULL
    ALTER TABLE [dbo].[zones] ADD [name] nvarchar(150) NOT NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'type') IS NULL
    ALTER TABLE [dbo].[zones] ADD [type] nvarchar(20) NOT NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'polygon') IS NULL
    ALTER TABLE [dbo].[zones] ADD [polygon] nvarchar(MAX) NOT NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'inDirection') IS NULL
    ALTER TABLE [dbo].[zones] ADD [inDirection] nvarchar(10) NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'engagedDwellSec') IS NULL
    ALTER TABLE [dbo].[zones] ADD [engagedDwellSec] int NOT NULL CONSTRAINT [DF_4f04f87caf1fa496ced5c2d5994] DEFAULT 30;
GO
IF COL_LENGTH(N'dbo.zones', N'queueAlertLength') IS NULL
    ALTER TABLE [dbo].[zones] ADD [queueAlertLength] int NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'queueAlertWaitSec') IS NULL
    ALTER TABLE [dbo].[zones] ADD [queueAlertWaitSec] int NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'referenceSnapshotId') IS NULL
    ALTER TABLE [dbo].[zones] ADD [referenceSnapshotId] int NULL;
GO
IF COL_LENGTH(N'dbo.zones', N'isActive') IS NULL
    ALTER TABLE [dbo].[zones] ADD [isActive] bit NOT NULL CONSTRAINT [DF_b180effa2280f809c6b27b4d83f] DEFAULT 1;
GO
IF COL_LENGTH(N'dbo.zones', N'createdAt') IS NULL
    ALTER TABLE [dbo].[zones] ADD [createdAt] datetime2 NOT NULL CONSTRAINT [DF_d0c631cd057d54c64b985977ee6] DEFAULT SYSUTCDATETIME();
GO

/* ---------------------------------------------------------------- indexes */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ai_detections_store_ts' AND object_id = OBJECT_ID(N'dbo.ai_detections'))
    CREATE INDEX [IX_ai_detections_store_ts] ON [dbo].[ai_detections] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ai_detections_ts' AND object_id = OBJECT_ID(N'dbo.ai_detections'))
    CREATE INDEX [IX_ai_detections_ts] ON [dbo].[ai_detections] ([ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ai_detections_rule_store_date' AND object_id = OBJECT_ID(N'dbo.ai_detections'))
    CREATE INDEX [IX_ai_detections_rule_store_date] ON [dbo].[ai_detections] ([ruleId], [storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ai_detections_store_date' AND object_id = OBJECT_ID(N'dbo.ai_detections'))
    CREATE INDEX [IX_ai_detections_store_date] ON [dbo].[ai_detections] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stores_regionId' AND object_id = OBJECT_ID(N'dbo.stores'))
    CREATE INDEX [IX_stores_regionId] ON [dbo].[stores] ([regionId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_alerts_createdAt' AND object_id = OBJECT_ID(N'dbo.alerts'))
    CREATE INDEX [IX_alerts_createdAt] ON [dbo].[alerts] ([createdAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_alerts_rule_store_created' AND object_id = OBJECT_ID(N'dbo.alerts'))
    CREATE INDEX [IX_alerts_rule_store_created] ON [dbo].[alerts] ([ruleId], [storeId], [createdAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_alerts_store_status' AND object_id = OBJECT_ID(N'dbo.alerts'))
    CREATE INDEX [IX_alerts_store_status] ON [dbo].[alerts] ([storeId], [status]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_user' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
    CREATE INDEX [IX_audit_logs_user] ON [dbo].[audit_logs] ([userId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_createdAt' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
    CREATE INDEX [IX_audit_logs_createdAt] ON [dbo].[audit_logs] ([createdAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_camera_status_log_store' AND object_id = OBJECT_ID(N'dbo.camera_status_log'))
    CREATE INDEX [IX_camera_status_log_store] ON [dbo].[camera_status_log] ([storeId], [startedAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_camera_status_log_camera' AND object_id = OBJECT_ID(N'dbo.camera_status_log'))
    CREATE INDEX [IX_camera_status_log_camera] ON [dbo].[camera_status_log] ([cameraId], [startedAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_recorders_storeId' AND object_id = OBJECT_ID(N'dbo.recorders'))
    CREATE INDEX [IX_recorders_storeId] ON [dbo].[recorders] ([storeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_recorders_store_host_port' AND object_id = OBJECT_ID(N'dbo.recorders'))
    CREATE UNIQUE INDEX [UQ_recorders_store_host_port] ON [dbo].[recorders] ([storeId], [host], [rtspPort]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cameras_storeId' AND object_id = OBJECT_ID(N'dbo.cameras'))
    CREATE INDEX [IX_cameras_storeId] ON [dbo].[cameras] ([storeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cameras_recorderId' AND object_id = OBJECT_ID(N'dbo.cameras'))
    CREATE INDEX [IX_cameras_recorderId] ON [dbo].[cameras] ([recorderId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_submissions_store_date' AND object_id = OBJECT_ID(N'dbo.checklist_submissions'))
    CREATE INDEX [IX_checklist_submissions_store_date] ON [dbo].[checklist_submissions] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_questions_template' AND object_id = OBJECT_ID(N'dbo.checklist_questions'))
    CREATE INDEX [IX_checklist_questions_template] ON [dbo].[checklist_questions] ([templateId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_answers_submission' AND object_id = OBJECT_ID(N'dbo.checklist_answers'))
    CREATE INDEX [IX_checklist_answers_submission] ON [dbo].[checklist_answers] ([submissionId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_assignments_status_due' AND object_id = OBJECT_ID(N'dbo.checklist_assignments'))
    CREATE INDEX [IX_checklist_assignments_status_due] ON [dbo].[checklist_assignments] ([status], [dueAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_assignments_assignee' AND object_id = OBJECT_ID(N'dbo.checklist_assignments'))
    CREATE INDEX [IX_checklist_assignments_assignee] ON [dbo].[checklist_assignments] ([assigneeId], [status]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_checklist_assignments_store_due' AND object_id = OBJECT_ID(N'dbo.checklist_assignments'))
    CREATE INDEX [IX_checklist_assignments_store_due] ON [dbo].[checklist_assignments] ([storeId], [dueDate]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_discovered_devices_store_host_port' AND object_id = OBJECT_ID(N'dbo.discovered_devices'))
    CREATE UNIQUE INDEX [UQ_discovered_devices_store_host_port] ON [dbo].[discovered_devices] ([storeId], [host], [rtspPort]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_edge_devices_storeId' AND object_id = OBJECT_ID(N'dbo.edge_devices'))
    CREATE INDEX [IX_edge_devices_storeId] ON [dbo].[edge_devices] ([storeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_heatmap_frames_store_date' AND object_id = OBJECT_ID(N'dbo.heatmap_frames'))
    CREATE INDEX [IX_heatmap_frames_store_date] ON [dbo].[heatmap_frames] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_heatmap_frames_camera_date_hour' AND object_id = OBJECT_ID(N'dbo.heatmap_frames'))
    CREATE UNIQUE INDEX [UQ_heatmap_frames_camera_date_hour] ON [dbo].[heatmap_frames] ([cameraId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hourly_store_metrics_date' AND object_id = OBJECT_ID(N'dbo.hourly_store_metrics'))
    CREATE INDEX [IX_hourly_store_metrics_date] ON [dbo].[hourly_store_metrics] ([date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_hourly_store_metrics' AND object_id = OBJECT_ID(N'dbo.hourly_store_metrics'))
    CREATE UNIQUE INDEX [UQ_hourly_store_metrics] ON [dbo].[hourly_store_metrics] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hourly_zone_metrics_store_date_hour' AND object_id = OBJECT_ID(N'dbo.hourly_zone_metrics'))
    CREATE INDEX [IX_hourly_zone_metrics_store_date_hour] ON [dbo].[hourly_zone_metrics] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_hourly_zone_metrics' AND object_id = OBJECT_ID(N'dbo.hourly_zone_metrics'))
    CREATE UNIQUE INDEX [UQ_hourly_zone_metrics] ON [dbo].[hourly_zone_metrics] ([zoneId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ingest_batches_created' AND object_id = OBJECT_ID(N'dbo.ingest_batches'))
    CREATE INDEX [IX_ingest_batches_created] ON [dbo].[ingest_batches] ([createdAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ingest_batches_store_kind_batch' AND object_id = OBJECT_ID(N'dbo.ingest_batches'))
    CREATE UNIQUE INDEX [UQ_ingest_batches_store_kind_batch] ON [dbo].[ingest_batches] ([storeId], [kind], [batchId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_notifications_user_created' AND object_id = OBJECT_ID(N'dbo.notifications'))
    CREATE INDEX [IX_notifications_user_created] ON [dbo].[notifications] ([userId], [createdAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pos_transactions_store_ts' AND object_id = OBJECT_ID(N'dbo.pos_transactions'))
    CREATE INDEX [IX_pos_transactions_store_ts] ON [dbo].[pos_transactions] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pos_transactions_store_date_hour' AND object_id = OBJECT_ID(N'dbo.pos_transactions'))
    CREATE INDEX [IX_pos_transactions_store_date_hour] ON [dbo].[pos_transactions] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_pos_transactions_store_bill' AND object_id = OBJECT_ID(N'dbo.pos_transactions'))
    CREATE UNIQUE INDEX [UQ_pos_transactions_store_bill] ON [dbo].[pos_transactions] ([storeId], [billNo]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_probes_camera' AND object_id = OBJECT_ID(N'dbo.probes'))
    CREATE INDEX [IX_probes_camera] ON [dbo].[probes] ([cameraId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_probes_recorder_channel' AND object_id = OBJECT_ID(N'dbo.probes'))
    CREATE INDEX [IX_probes_recorder_channel] ON [dbo].[probes] ([recorderId], [channel]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_probes_store_status' AND object_id = OBJECT_ID(N'dbo.probes'))
    CREATE INDEX [IX_probes_store_status] ON [dbo].[probes] ([storeId], [status]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_queue_snapshots_store_ts' AND object_id = OBJECT_ID(N'dbo.queue_snapshots'))
    CREATE INDEX [IX_queue_snapshots_store_ts] ON [dbo].[queue_snapshots] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_queue_snapshots_zone_ts' AND object_id = OBJECT_ID(N'dbo.queue_snapshots'))
    CREATE INDEX [IX_queue_snapshots_zone_ts] ON [dbo].[queue_snapshots] ([zoneId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_queue_snapshots_store_date_hour' AND object_id = OBJECT_ID(N'dbo.queue_snapshots'))
    CREATE INDEX [IX_queue_snapshots_store_date_hour] ON [dbo].[queue_snapshots] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_recaps_store_date' AND object_id = OBJECT_ID(N'dbo.recaps'))
    CREATE UNIQUE INDEX [UQ_recaps_store_date] ON [dbo].[recaps] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_snapshots_store_ts' AND object_id = OBJECT_ID(N'dbo.snapshots'))
    CREATE INDEX [IX_snapshots_store_ts] ON [dbo].[snapshots] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_snapshots_camera_ts' AND object_id = OBJECT_ID(N'dbo.snapshots'))
    CREATE INDEX [IX_snapshots_camera_ts] ON [dbo].[snapshots] ([cameraId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_snapshots_store_date' AND object_id = OBJECT_ID(N'dbo.snapshots'))
    CREATE INDEX [IX_snapshots_store_date] ON [dbo].[snapshots] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_staff_store_code' AND object_id = OBJECT_ID(N'dbo.staff'))
    CREATE UNIQUE INDEX [UQ_staff_store_code] ON [dbo].[staff] ([storeId], [code]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_storeops_events_store_ts' AND object_id = OBJECT_ID(N'dbo.storeops_events'))
    CREATE INDEX [IX_storeops_events_store_ts] ON [dbo].[storeops_events] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_storeops_events_store_date' AND object_id = OBJECT_ID(N'dbo.storeops_events'))
    CREATE INDEX [IX_storeops_events_store_date] ON [dbo].[storeops_events] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_assignee' AND object_id = OBJECT_ID(N'dbo.tasks'))
    CREATE INDEX [IX_tasks_assignee] ON [dbo].[tasks] ([assigneeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_store_status' AND object_id = OBJECT_ID(N'dbo.tasks'))
    CREATE INDEX [IX_tasks_store_status] ON [dbo].[tasks] ([storeId], [status]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tickets_store_status' AND object_id = OBJECT_ID(N'dbo.tickets'))
    CREATE INDEX [IX_tickets_store_status] ON [dbo].[tickets] ([storeId], [status]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ticket_comments_ticket' AND object_id = OBJECT_ID(N'dbo.ticket_comments'))
    CREATE INDEX [IX_ticket_comments_ticket] ON [dbo].[ticket_comments] ([ticketId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_user_stores_storeId' AND object_id = OBJECT_ID(N'dbo.user_stores'))
    CREATE INDEX [IX_user_stores_storeId] ON [dbo].[user_stores] ([storeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_vendor_visits_store_sched' AND object_id = OBJECT_ID(N'dbo.vendor_visits'))
    CREATE INDEX [IX_vendor_visits_store_sched] ON [dbo].[vendor_visits] ([storeId], [scheduledAt]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visitor_events_store_ts' AND object_id = OBJECT_ID(N'dbo.visitor_events'))
    CREATE INDEX [IX_visitor_events_store_ts] ON [dbo].[visitor_events] ([storeId], [ts]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visitor_events_store_visitor' AND object_id = OBJECT_ID(N'dbo.visitor_events'))
    CREATE INDEX [IX_visitor_events_store_visitor] ON [dbo].[visitor_events] ([storeId], [visitorId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visitor_events_store_date_hour' AND object_id = OBJECT_ID(N'dbo.visitor_events'))
    CREATE INDEX [IX_visitor_events_store_date_hour] ON [dbo].[visitor_events] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visits_stale' AND object_id = OBJECT_ID(N'dbo.visits'))
    CREATE INDEX [IX_visits_stale] ON [dbo].[visits] ([exitTs], [entryTs]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visits_open' AND object_id = OBJECT_ID(N'dbo.visits'))
    CREATE INDEX [IX_visits_open] ON [dbo].[visits] ([storeId], [exitTs]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visits_store_visitor' AND object_id = OBJECT_ID(N'dbo.visits'))
    CREATE INDEX [IX_visits_store_visitor] ON [dbo].[visits] ([storeId], [visitorId], [entryTs]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_visits_store_date_hour' AND object_id = OBJECT_ID(N'dbo.visits'))
    CREATE INDEX [IX_visits_store_date_hour] ON [dbo].[visits] ([storeId], [date], [hour]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_zone_transitions_store_date' AND object_id = OBJECT_ID(N'dbo.zone_transitions'))
    CREATE INDEX [IX_zone_transitions_store_date] ON [dbo].[zone_transitions] ([storeId], [date]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_zones_storeId' AND object_id = OBJECT_ID(N'dbo.zones'))
    CREATE INDEX [IX_zones_storeId] ON [dbo].[zones] ([storeId]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_zones_cameraId' AND object_id = OBJECT_ID(N'dbo.zones'))
    CREATE INDEX [IX_zones_cameraId] ON [dbo].[zones] ([cameraId]);
GO

/* ---------------------------------------------------------------- foreign keys */
IF OBJECT_ID(N'dbo.FK_e8e1bca1933b58493e63ae9593b', N'F') IS NULL
    ALTER TABLE [dbo].[stores] ADD CONSTRAINT [FK_e8e1bca1933b58493e63ae9593b] FOREIGN KEY ([regionId]) REFERENCES [dbo].[regions] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_b90672563ff91a7b3d786a28fbb', N'F') IS NULL
    ALTER TABLE [dbo].[alert_rules] ADD CONSTRAINT [FK_b90672563ff91a7b3d786a28fbb] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_ef1e576efeb7e09651a740f3287', N'F') IS NULL
    ALTER TABLE [dbo].[alerts] ADD CONSTRAINT [FK_ef1e576efeb7e09651a740f3287] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[alert_rules] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_25ad228748a1854cfcf0ec644fd', N'F') IS NULL
    ALTER TABLE [dbo].[alerts] ADD CONSTRAINT [FK_25ad228748a1854cfcf0ec644fd] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_0fde9ee5882c3c578b9523563e2', N'F') IS NULL
    ALTER TABLE [dbo].[recorders] ADD CONSTRAINT [FK_0fde9ee5882c3c578b9523563e2] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_02371b424a0363f757b861defc6', N'F') IS NULL
    ALTER TABLE [dbo].[cameras] ADD CONSTRAINT [FK_02371b424a0363f757b861defc6] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_268a47a162bc204462369740a90', N'F') IS NULL
    ALTER TABLE [dbo].[cameras] ADD CONSTRAINT [FK_268a47a162bc204462369740a90] FOREIGN KEY ([recorderId]) REFERENCES [dbo].[recorders] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_c1a9d32f6dcaf6c3b75fd32fb4c', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD CONSTRAINT [FK_c1a9d32f6dcaf6c3b75fd32fb4c] FOREIGN KEY ([templateId]) REFERENCES [dbo].[checklist_templates] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_3d7d14431c586a5b36c1463a3ac', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD CONSTRAINT [FK_3d7d14431c586a5b36c1463a3ac] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_f3b8848fc7efd8a3c9861845216', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_submissions] ADD CONSTRAINT [FK_f3b8848fc7efd8a3c9861845216] FOREIGN KEY ([submittedById]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_7dd0b39810d39ddeafa148e5f52', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_questions] ADD CONSTRAINT [FK_7dd0b39810d39ddeafa148e5f52] FOREIGN KEY ([templateId]) REFERENCES [dbo].[checklist_templates] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_cef1db843973cacbf915ce83d87', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD CONSTRAINT [FK_cef1db843973cacbf915ce83d87] FOREIGN KEY ([submissionId]) REFERENCES [dbo].[checklist_submissions] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_79cc4022b79efdfb93541420a8f', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_answers] ADD CONSTRAINT [FK_79cc4022b79efdfb93541420a8f] FOREIGN KEY ([questionId]) REFERENCES [dbo].[checklist_questions] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_7d8e94ada00da2873291be4e59a', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD CONSTRAINT [FK_7d8e94ada00da2873291be4e59a] FOREIGN KEY ([templateId]) REFERENCES [dbo].[checklist_templates] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_9d129ba8e64e8ddb78b96759c5f', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD CONSTRAINT [FK_9d129ba8e64e8ddb78b96759c5f] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_8514153df381c744d469fd9eb00', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_assignments] ADD CONSTRAINT [FK_8514153df381c744d469fd9eb00] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_5e4a918c5cf29628a2e37d55cd9', N'F') IS NULL
    ALTER TABLE [dbo].[checklist_schedules] ADD CONSTRAINT [FK_5e4a918c5cf29628a2e37d55cd9] FOREIGN KEY ([templateId]) REFERENCES [dbo].[checklist_templates] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_42a094c0931d2dff0aebe7afbc0', N'F') IS NULL
    ALTER TABLE [dbo].[documents] ADD CONSTRAINT [FK_42a094c0931d2dff0aebe7afbc0] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_5aad3bc717a4f483887ec61dbc8', N'F') IS NULL
    ALTER TABLE [dbo].[documents] ADD CONSTRAINT [FK_5aad3bc717a4f483887ec61dbc8] FOREIGN KEY ([uploadedById]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_d255e80c0b33bc8f9aec5d55a8e', N'F') IS NULL
    ALTER TABLE [dbo].[edge_devices] ADD CONSTRAINT [FK_d255e80c0b33bc8f9aec5d55a8e] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_692a909ee0fa9383e7859f9b406', N'F') IS NULL
    ALTER TABLE [dbo].[notifications] ADD CONSTRAINT [FK_692a909ee0fa9383e7859f9b406] FOREIGN KEY ([userId]) REFERENCES [dbo].[users] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_d658ac3ae6b6d21733e12b2b5bc', N'F') IS NULL
    ALTER TABLE [dbo].[pos_transactions] ADD CONSTRAINT [FK_d658ac3ae6b6d21733e12b2b5bc] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_0a220824ab2f3ec9b76324afac9', N'F') IS NULL
    ALTER TABLE [dbo].[staff] ADD CONSTRAINT [FK_0a220824ab2f3ec9b76324afac9] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_2ef4453264f816c9b2e4fc9f4ea', N'F') IS NULL
    ALTER TABLE [dbo].[tasks] ADD CONSTRAINT [FK_2ef4453264f816c9b2e4fc9f4ea] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_9a16d2c86252529f622fa53f1e3', N'F') IS NULL
    ALTER TABLE [dbo].[tasks] ADD CONSTRAINT [FK_9a16d2c86252529f622fa53f1e3] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_660898d912c6e71107e9ef8f38d', N'F') IS NULL
    ALTER TABLE [dbo].[tasks] ADD CONSTRAINT [FK_660898d912c6e71107e9ef8f38d] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_570fcaf1ded0b663af9eea2a0be', N'F') IS NULL
    ALTER TABLE [dbo].[tickets] ADD CONSTRAINT [FK_570fcaf1ded0b663af9eea2a0be] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_4f127f7c92139971ec4cbbe0bd5', N'F') IS NULL
    ALTER TABLE [dbo].[tickets] ADD CONSTRAINT [FK_4f127f7c92139971ec4cbbe0bd5] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_b1930f86a5e9b5b5be3689fc820', N'F') IS NULL
    ALTER TABLE [dbo].[tickets] ADD CONSTRAINT [FK_b1930f86a5e9b5b5be3689fc820] FOREIGN KEY ([reporterId]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_f6beba8ae36e1ce20968d7a3192', N'F') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD CONSTRAINT [FK_f6beba8ae36e1ce20968d7a3192] FOREIGN KEY ([ticketId]) REFERENCES [dbo].[tickets] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_c0867d6b917365bf9041cbe083f', N'F') IS NULL
    ALTER TABLE [dbo].[ticket_comments] ADD CONSTRAINT [FK_c0867d6b917365bf9041cbe083f] FOREIGN KEY ([userId]) REFERENCES [dbo].[users] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_c1ae840a5dd1c3b47e9e0295e71', N'F') IS NULL
    ALTER TABLE [dbo].[user_stores] ADD CONSTRAINT [FK_c1ae840a5dd1c3b47e9e0295e71] FOREIGN KEY ([userId]) REFERENCES [dbo].[users] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_fa944659f67025510ca20ccb7ed', N'F') IS NULL
    ALTER TABLE [dbo].[user_stores] ADD CONSTRAINT [FK_fa944659f67025510ca20ccb7ed] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_8f9d41829c3d3746c638a126e28', N'F') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD CONSTRAINT [FK_8f9d41829c3d3746c638a126e28] FOREIGN KEY ([vendorId]) REFERENCES [dbo].[vendors] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_ae637046093855d06c8bfb17b88', N'F') IS NULL
    ALTER TABLE [dbo].[vendor_visits] ADD CONSTRAINT [FK_ae637046093855d06c8bfb17b88] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_91b3f2a793bdeea8b2512857ada', N'F') IS NULL
    ALTER TABLE [dbo].[zones] ADD CONSTRAINT [FK_91b3f2a793bdeea8b2512857ada] FOREIGN KEY ([storeId]) REFERENCES [dbo].[stores] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
IF OBJECT_ID(N'dbo.FK_ca8d5b97f9552e8ca9e13f9d6bb', N'F') IS NULL
    ALTER TABLE [dbo].[zones] ADD CONSTRAINT [FK_ca8d5b97f9552e8ca9e13f9d6bb] FOREIGN KEY ([cameraId]) REFERENCES [dbo].[cameras] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO
