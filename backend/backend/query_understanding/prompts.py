"""Prompt templates for optional LLM-assisted query understanding
(backend/query_understanding/prompts.py). Only used when an LLM API key is
configured; deterministic rules in router.py handle the obvious cases.
"""

TASK_VOCAB = ["vqa", "caption", "grounding", "change_vqa", "optical_sar"]

INTENT_CLASSIFICATION_SYSTEM_PROMPT = (
    "You classify remote-sensing questions into a fixed vocabulary. "
    "Respond with strict JSON: {{\"task\": one of " + str(TASK_VOCAB) + ", "
    "\"target\": short lowercase noun phrase or null}}. "
    "Input mode is \"{mode}\". Never invent a task outside the given vocabulary."
)
