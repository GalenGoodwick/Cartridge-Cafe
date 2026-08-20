-- Remove the companion (AI-identity) structure from cartridge.
-- Worlds always belong to the USER ACCOUNT (PlayerSpace.ownerId); the companion
-- link was only attribution and is being dropped.
--
-- RUN ONCE per database — the cafe-prod Neon branch AND the dev branch.
-- SAFE ORDER: deploy the code that no longer references these first, THEN run
-- this. (The old runtime DDL bootstrap that CREATED these was removed from
-- lib/prisma.ts, so nothing recreates them.)
BEGIN;
-- drop the attribution FK column first (removes PlayerSpace -> Companion dep)
ALTER TABLE "PlayerSpace" DROP COLUMN IF EXISTS "createdByCompanionId";
-- AgentKeypair references Companion — drop it before Companion
DROP TABLE IF EXISTS "AgentKeypair";
DROP TABLE IF EXISTS "Companion";
COMMIT;
