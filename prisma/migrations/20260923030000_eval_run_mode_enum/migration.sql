-- Make the persisted evaluation mode a closed contract.
-- Refuse deployment if historical data contains an unrecognised mode instead
-- of silently coercing or dropping evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "eval_runs"
    WHERE "mode" NOT IN ('lexical', 'hybrid', 'answer')
  ) THEN
    RAISE EXCEPTION 'eval_runs.mode contains an unsupported value';
  END IF;
END $$;

CREATE TYPE "EvalRunMode" AS ENUM ('lexical', 'hybrid', 'answer');

ALTER TABLE "eval_runs"
  ALTER COLUMN "mode" TYPE "EvalRunMode"
  USING "mode"::text::"EvalRunMode";
