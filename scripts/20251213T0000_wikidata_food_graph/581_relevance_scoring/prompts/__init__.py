#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prompts/__init__.py

【目的】
prompts モジュールの初期化
"""

# Phase1 / Phase2 の prompt 関数をエクスポート
from .jp_relevance_scoring_phase1 import (
    build_system_prompt as build_system_prompt_phase1,
    build_user_message as build_user_message_phase1,
    build_tool_spec as build_tool_spec_phase1
)

from .jp_relevance_scoring_phase2 import (
    build_system_prompt as build_system_prompt_phase2,
    build_user_message as build_user_message_phase2,
    build_tool_spec as build_tool_spec_phase2
)

__all__ = [
    'build_system_prompt_phase1',
    'build_user_message_phase1',
    'build_tool_spec_phase1',
    'build_system_prompt_phase2',
    'build_user_message_phase2',
    'build_tool_spec_phase2',
]
