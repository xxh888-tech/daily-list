# -*- coding: utf-8 -*-
"""英语复习提醒：统计今日到期单词和错词；周日自动生成周报写入应用。输出供微信推送。"""
import json
import sys
import io
from datetime import date, datetime, timedelta
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

    parts = ["【英语复习提醒】"]
    if due:
        preview = "、".join(str(w.get("word")) for w in due[:5])
        parts.append(f"📅 {len(due)} 个单词今日到期（{preview}{'…' if len(due) > 5 else ''}）")
    if active_wrong:
        parts.append(f"✗ 错词本还有 {len(active_wrong)} 个待消灭")

    # 周日：自动生成英语周报并写回应用
    if date.today().weekday() == 6:
        lines, report = build_weekly_report(data)
        if report:
            save_weekly_report(data, report)
        parts.append("")
        parts.append("📊 英语周报（本周）")
        parts.extend(lines)

    if len(parts) <= 1 and not due and not active_wrong:
        print(f"【英语复习提醒】今天没有到期的复习任务，错词本也是空的！连续打卡 {streak} 天，太棒了 🎉")
        return
    parts.append(f"🔥 已连续打卡 {streak} 天，别断了哦～")
    print("\n".join(parts))


def build_weekly_report(data):
    """汇总近7天数据，返回 (微信推送行, 周报dict或None)"""
    store = data.get("english") or {}
    log = store.get("log") or {}
    words = store.get("words") or {}
    wrong = store.get("wrongWords") or {}
    week_start = (date.today() - timedelta(days=6)).isoformat()
    logs = [l for d, l in log.items() if str(d) >= week_start and isinstance(l, dict)]
    new_words = sum(int(l.get("newWords") or 0) for l in logs)
    correct = sum(int(l.get("correct") or 0) for l in logs)
    wrong_cnt = sum(int(l.get("wrong") or 0) for l in logs)
    speaking = sum(int(l.get("speakingMessages") or 0) for l in logs)
    plan_days = sum(1 for l in logs if int(l.get("planCompleted") or 0) > 0)
    mastered = len([w for w in words.values() if isinstance(w, dict) and w.get("status") == "mastered"])
    active_wrong = [w for w in wrong.values() if isinstance(w, dict) and not w.get("mastered")]
    accuracy = f"{round(correct / (correct + wrong_cnt) * 100)}%" if correct + wrong_cnt else "暂无"
    lines = [
        f"• 新学 {new_words} 词 · 复习正确率 {accuracy}（对{correct}/错{wrong_cnt}）",
        f"• 口语练习 {speaking} 条 · 完成任务 {plan_days} 天",
        f"• 词库 {len(words)} 词（已掌握 {mastered}）· 待消灭错词 {len(active_wrong)} 个",
    ]
    if speaking == 0:
        lines.append("💡 本周还没开口练口语，找个话题和 AI 教练聊聊吧")
    report = None
    if new_words or correct or wrong_cnt or speaking or plan_days:
        report = {"weekStart": week_start, "newWords": new_words, "correct": correct, "wrong": wrong_cnt,
                  "speakingMessages": speaking, "planDays": plan_days, "totalWords": len(words),
                  "mastered": mastered, "activeWrong": len(active_wrong),
                  "topWrong": sorted({str(w.get("word")) for w in active_wrong})[:5],
                  "summary": f"本周新学 {new_words} 个单词，复习正确率 {accuracy}，口语 {speaking} 条，打卡 {plan_days} 天。词库累计 {len(words)} 词，已掌握 {mastered} 个。",
                  "advice": [], "encouragement": "坚持就是胜利！", "source": "local",
                  "generatedAt": datetime.now().isoformat(timespec="seconds")}
    return lines, report


def save_weekly_report(data, report):
    """把本地生成的周报写回 data.json，应用里就能看到（已有则跳过）"""
    try:
        english = data.setdefault("english", {})
        reports = english.setdefault("weeklyReports", {})
        if report["weekStart"] in reports:
            return
        reports[report["weekStart"]] = report
        cutoff = sorted(reports.keys())[:-8]
        for old in cutoff:
            del reports[old]
        DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


if __name__ == "__main__":
    main()
