SET @staticValueSource = (  SELECT `Value` FROM `TBLMStandardMasterDetail` WHERE `UID` = 'SUGGESTION_BASED_TEXTBOX');Add commentMore actions

SET @NotificationBlockId = (SELECT `BlockId` FROM `TBLMBuildingBlocks`  WHERE `UID` = 'PREPARENOTIFICATION');

UPDATE `TBLMBuildingBlocksProperties`SET `ComponentType` = @staticValueSource WHERE `BlockId` = @NotificationBlockId AND UID="BODY_PREPARENOTIFICATION";

UPDATE TBLMBuildingBlocksProperties SET RegularExpression = '^[A-Za-z0-9]+$', ValidationMessage = 'Only letters and numbers allowed' WHERE Name = 'OutputPersistKey';Add commentMore actions

ALTER TABLE TBLMCounter MODIFY COLUMN ResetType TINYINT(1) NOT NULL;