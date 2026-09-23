-- P7-2 收尾：LLM 答案评测。EvalCase 增加用例类型与评分要点。
ALTER TABLE "eval_cases" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'retrieval';
ALTER TABLE "eval_cases" ADD COLUMN "rubric" TEXT NOT NULL DEFAULT '';
