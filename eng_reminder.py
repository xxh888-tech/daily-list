# -*- coding: utf-8 -*-
"""英语复习提醒：统计今日到期单词和错词，输出摘要供微信推送。"""
import json
import sys
import io
from datetime import date, timedelta
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DATA = Path(__file__).parent / "data.json"


def main():
    try:
        data = json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("英语提醒：读取 data.json 失败")
        return
    store = data.get("english") or {}
    words = store.get("words") or {}
    wrong = store.get("wrongWords") or {}
    log = store.get("log") or {}

    today = date.today().isoformat()
    active_wrong = [w for w in wrong.values() if isinstance(w, dict) and not w.get("mastered")]
    wrong_keys = {str(w.get("word", "")).lower() for w in active_wrong}
    due = [w for w in words.values() if isinstance(w, dict) and w.get("status") != "mastered"
           and str(w.get("nextReviewAt") or "9999") <= today and str(w.get("word", "")).lower() not in wrong_keys]

    # 连续打卡天数
    streak = 0
    cursor = date.today()
    while True:
        day = log.get(cursor.isoformat()) or {}
        if any(int(day.get(k) or 0) > 0 for k in ("newWords", "correct", "wrong", "speakingMessages", "planCompleted")):
            streak += 1
            cursor -= timedelta(days=1)
        else:
            break

    parts = []
    if due:
        preview = "、".join(str(w.get("word")) for w in due[:5])
        parts.append(f"📅 {len(due)} 个单词今日到期（{preview}{'…' if len(due) > 5 else ''}）")
    if active_wrong:
        parts.append(f"✗ 错词本还有 {len(active_wrong)} 个待消灭")
    if not parts:
        print(f"英语打卡提醒：今天没有到期的复习任务，错词本也是空的！连续打卡 {streak} 天，太棒了 🎉")
        return
    parts.append(f"🔥 已连续打卡 {streak} 天，别断了哦～")
    print("【英语复习提醒】\n" + "\n".join(parts))


if __name__ == "__main__":
    main()
