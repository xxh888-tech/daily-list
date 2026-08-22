#!/usr/bin/env python3
"""A tiny LAN-friendly server for the Daily List app."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import csv
import io
import json
import os
import re
import uuid
import math
import urllib.error
import urllib.request
from datetime import datetime, timedelta

ROOT = Path(__file__).parent.resolve()
DATA_FILE = ROOT / "data.json"
CONFIG_FILE = ROOT / "config.json"
BACKUP_DIR = ROOT / "backups"
MAX_BACKUPS = 7
PORT = 8000
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
GOAL_CATEGORIES = {"健康", "学习", "工作", "生活", "减肥"}
GOAL_METRICS = {
    "健康": {"distance": "公里", "duration": "小时", "completedCount": "次"},
    "学习": {"duration": "小时", "completedCount": "次"},
    "工作": {"completedCount": "个", "duration": "小时"},
    "生活": {"completedCount": "个", "duration": "小时"},
    "减肥": {"weight": "kg"},
}


def read_data():
    if not DATA_FILE.exists():
        return {"tasks": [], "dailyRecords": {}, "goals": [], "habits": [], "growthReports": {}, "settings": {"name": "我的每日清单"}}
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"tasks": [], "dailyRecords": {}, "goals": [], "habits": [], "growthReports": {}, "settings": {"name": "我的每日清单"}}


def _clean_goal(payload, existing=None):
    source = {**(existing or {}), **(payload or {})}
    name = _clean_text(source.get("name") or source.get("title"), 100)
    category = source.get("category") if source.get("category") in GOAL_CATEGORIES else "学习"
    period = source.get("period") if source.get("period") in {"week", "month", "year"} else "month"
    metric = source.get("metric") if source.get("metric") in GOAL_METRICS[category] else next(iter(GOAL_METRICS[category]))
    try:
        target = float(source.get("targetValue", source.get("target", source.get("value", 0))))
    except (TypeError, ValueError):
        target = 0
    if not math.isfinite(target) or target <= 0:
        raise ValueError("目标数值必须大于 0")
    try:
        start_weight = float(source.get("startWeight", 0))
    except (TypeError, ValueError):
        start_weight = 0
    if not math.isfinite(start_weight) or start_weight <= 0:
        start_weight = ""
    elif start_weight.is_integer():
        start_weight = int(start_weight)
    else:
        start_weight = round(start_weight, 2)
    return {"id": source.get("id") or uuid.uuid4().hex, "name": name, "category": category,
            "period": period, "metric": metric, "targetValue": int(target) if target.is_integer() else round(target, 2),
            "startWeight": start_weight if category == "减肥" else "",
            "unit": GOAL_METRICS[category][metric], "createdAt": source.get("createdAt") or datetime.now().isoformat(timespec="seconds")}


def _clean_habit(payload, existing=None):
    source = {**(existing or {}), **(payload or {})}
    name = _clean_text(source.get("name"), 100)
    category = source.get("category") if source.get("category") in {"工作", "生活", "学习", "健康", "其他"} else "其他"
    subcategory = _clean_text(source.get("subcategory"), 50)
    time_value = str(source.get("time") or "").strip()
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", time_value):
        time_value = ""
    return {"id": source.get("id") or uuid.uuid4().hex, "name": name, "category": category,
            "subcategory": subcategory, "time": time_value, "note": _clean_text(source.get("note"), 200),
            "createdAt": source.get("createdAt") or datetime.now().isoformat(timespec="seconds")}


def backup_data():
    """每天第一次修改数据前，把 data.json 备份到 backups/ 目录，最多保留最近 MAX_BACKUPS 份。"""
    try:
        if not DATA_FILE.exists():
            return
        BACKUP_DIR.mkdir(exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        if any(BACKUP_DIR.glob(f"data-{today}*.json")):
            return
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        (BACKUP_DIR / f"data-{stamp}.json").write_bytes(DATA_FILE.read_bytes())
        backups = sorted(BACKUP_DIR.glob("data-*.json"))
        for old in backups[:-MAX_BACKUPS]:
            try:
                old.unlink()
            except OSError:
                pass
    except OSError:
        pass


MOOD_LABELS = {"happy": "开心", "calm": "平静", "okay": "一般", "tired": "疲惫", "sad": "低落"}


def _money_total(items):
    if not isinstance(items, list):
        return 0.0
    total = 0.0
    for item in items:
        try:
            amount = float(item.get("amount", 0)) if isinstance(item, dict) else 0.0
        except (TypeError, ValueError, AttributeError):
            amount = 0.0
        if math.isfinite(amount) and amount > 0:
            total += amount
    return round(total, 2)


def _build_tasks_csv(data):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["日期", "时间", "标题", "分类", "子分类", "优先级", "是否完成", "时长(分钟)", "距离(km)", "次数", "备注"])
    priority_labels = {"high": "重要", "normal": "普通", "low": "不紧急"}
    for task in sorted(data.get("tasks", []), key=lambda item: (str(item.get("date", "")), str(item.get("time", "")))):
        metrics = _task_metrics(task)
        duration, _estimated = _task_duration(task, metrics)
        category = str(task.get("category") or "")
        subcategory = _task_type(task) if category != "其他" else str(task.get("subcategory") or "")
        writer.writerow([
            task.get("date", ""), task.get("time", ""), task.get("title", ""), category,
            subcategory, priority_labels.get(task.get("priority"), "普通"),
            "已完成" if task.get("done") else "未完成",
            round(duration) if duration else "", metrics.get("distanceKm", ""), metrics.get("count", ""),
            task.get("note", ""),
        ])
    return buf.getvalue()


def _build_days_csv(data):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["日期", "体重(kg)", "心情", "早餐", "午餐", "晚餐", "特殊日子", "消费合计(元)", "收入合计(元)", "一句话总结"])
    records = data.get("dailyRecords", {})
    for date in sorted(records.keys()):
        record = records[date] if isinstance(records[date], dict) else {}
        weight = record.get("weight", "")
        try:
            weight = float(weight)
            weight = round(weight, 2)
        except (TypeError, ValueError):
            weight = ""
        expense_items = record.get("expenseItems")
        income_items = record.get("incomeItems")
        if expense_items is None:
            try:
                legacy_expense = float(record.get("expense") or 0)
                expense_items = [{"amount": legacy_expense}] if legacy_expense > 0 else []
            except (TypeError, ValueError):
                expense_items = []
        if income_items is None:
            try:
                legacy_income = float(record.get("income") or 0)
                income_items = [{"amount": legacy_income}] if legacy_income > 0 else []
            except (TypeError, ValueError):
                income_items = []
        special_label = str(record.get("specialLabel") or "") if record.get("special") else ""
        writer.writerow([
            date, weight, MOOD_LABELS.get(record.get("mood"), ""),
            record.get("breakfast", ""), record.get("lunch", ""), record.get("dinner", ""), special_label,
            _money_total(expense_items), _money_total(income_items),
            record.get("reviewSummary", ""),
        ])
    return buf.getvalue()


def save_data(data):
    backup_data()
    temp = DATA_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(DATA_FILE)


def load_config():
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return config if isinstance(config, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _clean_text(value, limit=1000):
    return str(value or "").strip()[:limit]


def _clean_metrics(value):
    """Optional, backward-compatible quantitative task metrics."""
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in ("durationMinutes", "distanceKm", "count", "projectTimeMinutes"):
        try:
            number = float(value.get(key, 0))
        except (TypeError, ValueError):
            continue
        if math.isfinite(number) and number > 0:
            result[key] = int(number) if number.is_integer() else round(number, 2)
    return result


def _clean_measurement(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(number) or number <= 0:
        return ""
    return int(number) if number.is_integer() else round(number, 2)


def _task_metrics(task):
    metrics = _clean_metrics(task.get("metrics"))
    aliases = {"durationMinutes": "duration", "distanceKm": "distance", "count": "count", "projectTimeMinutes": "projectTimeMinutes"}
    for target, source in aliases.items():
        if target not in metrics and task.get(source) not in (None, ""):
            metrics.update(_clean_metrics({target: task.get(source)}))
    if "projectTimeMinutes" not in metrics and task.get("duration") not in (None, "") and task.get("category") == "工作":
        metrics.update(_clean_metrics({"projectTimeMinutes": task.get("duration")}))
    if "distanceKm" not in metrics:
        match = re.search(r"(\d+(?:\.\d+)?)\s*(公里|千米|km|kilometers?)", f"{task.get('title', '')} {task.get('note', '')}", re.IGNORECASE)
        if match:
            metrics["distanceKm"] = float(match.group(1))
    if "count" not in metrics and str(task.get("category") or "") == "健康" and _task_type(task) == "跳绳":
        match = re.search(r"(?:跳绳\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:次|个|下))", f"{task.get('title', '')} {task.get('note', '')}")
        if match:
            metrics["count"] = float(match.group(1) or match.group(2))
    return metrics


def _infer_sport_type(task):
    text = f"{task.get('title', '')} {task.get('note', '')}"
    for name, patterns in (("跑步", ("跑步", "慢跑", "长跑")), ("跳绳", ("跳绳",)), ("篮球", ("篮球",)), ("健身", ("健身", "力量训练", "举铁"))):
        if any(pattern in text for pattern in patterns):
            return name
    return ""


def _infer_learning_subject(task):
    text = f"{task.get('title', '')} {task.get('note', '')}"
    matches = (("教资科目一", ("教资科目一", "科目一")), ("教资科目二", ("教资科目二", "科目二")),
               ("教资科目三", ("教资科目三", "科目三")), ("英语单词", ("英语单词", "背单词", "单词")),
               ("英语听力", ("英语听力", "听力")), ("编程学习", ("编程", "代码", "开发")),
               ("AI学习", ("AI学习", "人工智能", "机器学习")))
    for name, patterns in matches:
        if any(pattern in text for pattern in patterns):
            return name
    return ""


def _work_type(task):
    if str(task.get("category") or "") != "工作":
        return ""
    return str(task.get("work_type") or task.get("type") or task.get("subcategory") or "未分类").strip() or "未分类"


def _task_type(task):
    category = str(task.get("category") or "其他")
    value = task.get("sport_type") if category == "健康" else task.get("type")
    if category == "健康" and not value:
        value = _infer_sport_type(task)
    if category == "学习":
        value = task.get("subject") or value or _infer_learning_subject(task)
    elif category == "工作":
        value = task.get("project")
        if not value:
            return "未分类"
    return str(value or task.get("subcategory") or "未分类").strip() or "未分类"


def _task_duration(task, metrics):
    duration = metrics.get("durationMinutes") or metrics.get("projectTimeMinutes")
    if duration:
        return duration, False
    legacy = task.get("duration")
    try:
        legacy = float(legacy)
    except (TypeError, ValueError):
        legacy = 0
    if legacy > 0:
        return (legacy * 60 if legacy < 10 else legacy), True
    match = re.search(r"(\d+(?:\.\d+)?)\s*(小时|小時|hour(?:s)?|h|分钟|分鐘|minute(?:s)?|min|分|m)",
                      f"{task.get('title', '')} {task.get('note', '')}", re.IGNORECASE)
    if match:
        amount = float(match.group(1))
        return (amount * 60 if re.match(r"小时|小時|hour|^h$", match.group(2), re.IGNORECASE) else amount), True
    return (30 if task.get("done") else 0), True


def _aggregate_tasks(tasks, category=None, type_name=None):
    result = {"taskCount": 0, "completedCount": 0, "durationMinutes": 0, "distanceKm": 0,
              "count": 0, "projectTimeMinutes": 0, "estimatedDuration": False}
    for task in tasks:
        if category is not None and str(task.get("category") or "其他") != category:
            continue
        if type_name is not None and _task_type(task) != type_name:
            continue
        result["taskCount"] += 1
        if not task.get("done"):
            continue
        metrics = _task_metrics(task)
        duration, estimated = _task_duration(task, metrics)
        result["completedCount"] += 1
        result["durationMinutes"] += duration
        result["distanceKm"] += metrics.get("distanceKm", 0)
        default_count = 0 if category == "健康" and _task_type(task) == "跳绳" else 1
        result["count"] += metrics.get("count", default_count)
        result["projectTimeMinutes"] += metrics.get("projectTimeMinutes", duration if category == "工作" else 0)
        result["estimatedDuration"] = result["estimatedDuration"] or estimated
    for key in ("durationMinutes", "distanceKm", "count", "projectTimeMinutes"):
        result[key] = round(result[key], 2)
    result["duration"] = result["durationMinutes"]
    result["distance"] = result["distanceKm"]
    return result


def _trend_dates(tasks, anchor, category, type_name=None):
    values = []
    for offset in range(6, -1, -1):
        day = anchor - timedelta(days=offset)
        stats = _aggregate_tasks([task for task in tasks if task.get("date") == day.isoformat()], category, type_name)
        values.append({"date": day.isoformat(), **stats})
    return values


def _monthly_trend(tasks, anchor, category, type_name=None):
    values = []
    for index in range(3, -1, -1):
        end = anchor - timedelta(days=index * 7)
        start = end - timedelta(days=6)
        stats = _aggregate_tasks([task for task in tasks if start.isoformat() <= str(task.get("date", "")) <= end.isoformat()], category, type_name)
        values.append({"start": start.isoformat(), "end": end.isoformat(), **stats})
    return values


def _yearly_trend(tasks, anchor, category, type_name=None):
    values = []
    for month in range(1, 13):
        start = anchor.replace(month=month, day=1)
        end = (start.replace(year=start.year + 1, month=1) - timedelta(days=1)) if month == 12 else start.replace(month=month + 1) - timedelta(days=1)
        stats = _aggregate_tasks([task for task in tasks if start.isoformat() <= str(task.get("date", "")) <= end.isoformat()], category, type_name)
        values.append({"start": start.isoformat(), "end": end.isoformat(), **stats})
    return values


def _period_summary(tasks, anchor, category, type_name=None):
    week_start = anchor - timedelta(days=anchor.weekday())
    month_start = anchor.replace(day=1)
    year_start = anchor.replace(month=1, day=1)
    ranges = {
        "today": (anchor, anchor),
        "week": (week_start, anchor),
        "month": (month_start, anchor),
        "year": (year_start, anchor),
    }
    return {name: _aggregate_tasks([task for task in tasks if start.isoformat() <= str(task.get("date", "")) <= end.isoformat()], category, type_name) for name, (start, end) in ranges.items()}


def build_stats(data, anchor=None):
    """Aggregate category/type metrics and weekly/monthly trends without changing persisted tasks."""
    categories = {}
    for task in data.get("tasks", []):
        category = str(task.get("category") or "其他")
        category_stats = categories.setdefault(category, {"taskCount": 0, "completedCount": 0,
            "durationMinutes": 0, "distanceKm": 0, "count": 0, "projectTimeMinutes": 0,
            "estimatedDuration": False, "types": {}})
        type_name = _task_type(task)
        type_stats = category_stats["types"].setdefault(type_name, {"type": type_name, "sport_type": type_name if category == "健康" else "", "work_type": _work_type(task),
            "taskCount": 0, "completedCount": 0, "durationMinutes": 0, "distanceKm": 0,
            "count": 0, "projectTimeMinutes": 0, "estimatedDuration": False})
        category_stats["taskCount"] += 1
        type_stats["taskCount"] += 1
        if not task.get("done"):
            continue
        metrics = _task_metrics(task)
        duration, estimated = _task_duration(task, metrics)
        distance = metrics.get("distanceKm", 0)
        default_count = 0 if category == "健康" and type_name == "跳绳" else 1
        count = metrics.get("count", default_count)
        project_time = metrics.get("projectTimeMinutes", duration if category == "工作" else 0)
        for target in (category_stats, type_stats):
            target["completedCount"] += 1
            target["durationMinutes"] += duration
            target["distanceKm"] += distance
            target["count"] += count
            target["projectTimeMinutes"] += project_time
            target["estimatedDuration"] = target["estimatedDuration"] or estimated
    for stats in categories.values():
        for target in [stats, *stats["types"].values()]:
            for key in ("durationMinutes", "distanceKm", "count", "projectTimeMinutes"):
                target[key] = round(target[key], 2)
            target["duration"] = target["durationMinutes"]
            target["distance"] = target["distanceKm"]
    tasks = data.get("tasks", [])
    if anchor:
        try:
            anchor_date = datetime.strptime(str(anchor), "%Y-%m-%d").date()
        except ValueError:
            anchor_date = None
    else:
        anchor_date = None
    if anchor_date is None:
        dates = [str(task.get("date")) for task in tasks if re.match(r"^\d{4}-\d{2}-\d{2}$", str(task.get("date", "")))]
        anchor_date = datetime.strptime(max(dates), "%Y-%m-%d").date() if dates else datetime.now().date()
    for category, stats in categories.items():
        stats["weeklyTrend"] = _trend_dates(tasks, anchor_date, category)
        stats["monthlyTrend"] = _monthly_trend(tasks, anchor_date, category)
        stats["yearlyTrend"] = _yearly_trend(tasks, anchor_date, category)
        if category == "健康":
            stats["healthSummary"] = _period_summary(tasks, anchor_date, category)
        completed_dates = [str(task.get("date")) for task in tasks if task.get("done") and str(task.get("category") or "其他") == category]
        stats["lastDate"] = max(completed_dates) if completed_dates else ""
        for type_name, type_stats in stats["types"].items():
            type_stats["weeklyTrend"] = _trend_dates(tasks, anchor_date, category, type_name)
            type_stats["monthlyTrend"] = _monthly_trend(tasks, anchor_date, category, type_name)
            type_stats["yearlyTrend"] = _yearly_trend(tasks, anchor_date, category, type_name)
            if category == "健康":
                type_stats["healthSummary"] = _period_summary(tasks, anchor_date, category, type_name)
            elif category == "学习":
                type_stats["learningSummary"] = _period_summary(tasks, anchor_date, category, type_name)
            elif category == "工作":
                type_stats["workSummary"] = _period_summary(tasks, anchor_date, category, type_name)
            type_dates = [str(task.get("date")) for task in tasks if task.get("done") and str(task.get("category") or "其他") == category and _task_type(task) == type_name]
            type_stats["lastDate"] = max(type_dates) if type_dates else ""
            if category == "学习":
                summary = type_stats["learningSummary"]
                type_stats["studyCount"] = type_stats["completedCount"]
                type_stats["totalStudyDuration"] = type_stats["durationMinutes"]
                type_stats["recentStudyDate"] = type_stats["lastDate"]
                type_stats["weekStudyMinutes"] = summary["week"]["durationMinutes"]
                type_stats["monthStudyMinutes"] = summary["month"]["durationMinutes"]
                type_stats["yearStudyMinutes"] = summary["year"]["durationMinutes"]
            elif category == "工作":
                summary = type_stats["workSummary"]
                type_stats["completedWorkTasks"] = type_stats["completedCount"]
                type_stats["totalWorkDuration"] = type_stats["projectTimeMinutes"]
                type_stats["recentCompletionDate"] = type_stats["lastDate"]
                type_stats["weekWorkMinutes"] = summary["week"]["projectTimeMinutes"]
                type_stats["monthWorkMinutes"] = summary["month"]["projectTimeMinutes"]
                type_stats["yearWorkMinutes"] = summary["year"]["projectTimeMinutes"]
    return {"anchor": anchor_date.isoformat(), "categories": categories}


def _local_review(payload):
    """A useful offline fallback when no OpenAI-compatible key is configured."""
    tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
    done = [t for t in tasks if t.get("done")]
    todo = [t for t in tasks if not t.get("done")]
    mood_names = {"happy": "开心", "calm": "平静", "okay": "一般", "tired": "疲惫", "sad": "低落"}
    mood = mood_names.get(payload.get("mood"), "未记录")
    highlights = _clean_text(payload.get("reviewHighlights"))
    challenges = _clean_text(payload.get("reviewChallenges"))
    gratitude = _clean_text(payload.get("reviewGratitude"))
    tomorrow_note = _clean_text(payload.get("reviewTomorrow"))
    summary_note = _clean_text(payload.get("reviewSummary"))
    done_names = "、".join(_clean_text(t.get("title"), 35) for t in done[:3]) or "暂未完成的任务"
    todo_names = "、".join(_clean_text(t.get("title"), 35) for t in todo[:3]) or "暂无未完成任务"
    summary = (f"今天的心情是{mood}，共安排{len(tasks)}项任务，完成{len(done)}项，"
               f"其中包括{done_names}。复盘记录中的亮点是{highlights or '暂未填写'}，"
               f"需要继续处理的是{challenges or todo_names}。"
               f"明天应先从{tomorrow_note or todo_names}开始，先做一个明确动作再推进。")
    if len(summary) < 100:
        summary += f"今天留下的{gratitude or '过程记录'}，可以作为明天调整节奏和安排优先级的依据。"
    summary = summary[:150]
    highlight_items = []
    if done:
        highlight_items.append({"point": f"完成了{done_names}", "reason": "把计划转化为可核验的结果，说明执行已经启动。"})
    if highlights:
        highlight_items.append({"point": highlights, "reason": "能指出具体经历，后续更容易复用有效做法。"})
    if gratitude:
        highlight_items.append({"point": gratitude, "reason": "识别到真实的满足来源，有助于稳定动力。"})
    if len(highlight_items) < 2:
        highlight_items.append({"point": f"完成了每日复盘记录（心情：{mood}）", "reason": "留下事实和感受，才能根据证据调整下一步。"})
    problems = []
    if todo:
        problems.append({"problem": f"仍有任务未完成：{todo_names}", "cause": "当前记录没有说明具体阻碍，优先需要拆出下一步动作并安排时间。"})
    if challenges:
        problems.append({"problem": challenges, "cause": "这是今天明确记录的卡点，建议补充触发场景和可控的处理动作。"})
    if not problems:
        problems.append({"problem": "暂未发现明确问题", "cause": "记录较完整但缺少可验证的阻碍描述，明天继续记录实际偏差。"})
    first_task = _clean_text((todo[0] if todo else {}).get("title") or tomorrow_note or "最重要任务", 40)
    suggestions = [
        f"明天先处理“{first_task}”，设置25分钟专注计时，结束后再决定是否继续。",
        "把今天的主要卡点写成一个‘如果……就……’方案，并在明天第一次遇到同类情况时立即执行。",
        "明天结束前用3分钟核对完成项、未完成原因和下一步，不只记录结果，还记录耗时和阻碍。",
    ]
    tomorrow = [_clean_text(t.get("title"), 60) for t in todo[:3]]
    if tomorrow_note:
        tomorrow.insert(0, tomorrow_note)
    tomorrow = list(dict.fromkeys(x for x in tomorrow if x))[:3]
    while len(tomorrow) < 3:
        tomorrow.append(["完成最重要的一项任务", "处理今天留下的卡点", "完成晚间复盘记录"][len(tomorrow)])
    return {"summary": summary, "highlights": highlight_items[:3], "problems": problems,
            "suggestions": suggestions, "tomorrow": tomorrow,
            "encouragement": f"你已经用记录看见了今天的真实状态；明天先完成{first_task[:30]}，一步一步推进即可。",
            "source": "local"}


def _parse_ai_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {"raw": text}


def _growth_report(payload):
    config = load_config()
    api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError(f"未找到 DeepSeek API Key，请在 {CONFIG_FILE.name} 中填写 deepseek_api_key")
    api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
    model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
    system = ("你是一名专业的个人成长分析师。根据用户提供的本周健康、学习、工作统计，"
              "生成客观、具体、有证据的每周成长报告。必须严格返回 JSON，不要 Markdown。"
              "字段必须包含：summary（本周数据总结）、healthAnalysis（健康表现分析）、"
              "learningAnalysis（学习表现分析）、workAnalysis（工作表现分析）、"
              "score（完成情况评分，0到100的数字，并附带reason）、strengths（优点总结字符串数组）、"
              "problems（问题分析对象数组，每项含problem和cause）、suggestions（下周改进建议字符串数组）。"
              "不要编造统计数据；数据不足时明确说明。")
    body = json.dumps({"model": model, "temperature": 0.4, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": f"本周资料：{json.dumps(payload, ensure_ascii=False)}"}]}).encode("utf-8")
    request = urllib.request.Request(api_url, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        report = _parse_ai_json(content)
        if not isinstance(report, dict):
            raise ValueError("成长报告返回格式不正确")
        report.setdefault("summary", "")
        report.setdefault("healthAnalysis", "")
        report.setdefault("learningAnalysis", "")
        report.setdefault("workAnalysis", "")
        report.setdefault("score", {"score": 0, "reason": "暂无评分"})
        report.setdefault("strengths", [])
        report.setdefault("problems", [])
        report.setdefault("suggestions", [])
        report["source"] = "ai"
        return report
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, IndexError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(f"AI 成长报告生成失败：{error}") from error


def _ai_review(payload):
    config = load_config()
    api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError(f"未找到 DeepSeek API Key，请在 {CONFIG_FILE.name} 中填写 deepseek_api_key")
    api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
    model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
    system = ("你是一名专业的学习教练和复盘顾问。根据用户当天的任务和复盘内容，"
              "生成具体、有证据、可执行的复盘。不要编造用户没有提供的事实，不要使用空泛套话。"
              "请严格返回 JSON，不要 Markdown，字段为：summary（100到150个汉字的今日总结）、"
              "highlights（2到3项对象数组，每项含point和reason）、problems（对象数组，每项含problem和cause）、"
              "suggestions（恰好3条可执行建议）、tomorrow（按优先级排序的恰好3件事）、encouragement（自然积极的一句话）。")
    user = json.dumps(payload, ensure_ascii=False)
    body = json.dumps({"model": model, "temperature": 0.4, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": f"今日资料：{user}"}]}).encode("utf-8")
    request = urllib.request.Request(api_url, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        review = _parse_ai_json(content)
        review["source"] = "ai"
        return review
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, IndexError, json.JSONDecodeError) as error:
        raise RuntimeError(f"AI 服务调用失败：{error}") from error


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        target = urlparse(self.path).path.lower()
        if target == "/" or target.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/config.json":
            self._json({"error": "Not found"}, 404)
            return
        if path == "/api/state":
            self._json(read_data())
            return
        if path == "/api/goals":
            self._json(read_data().get("goals", []))
            return
        if path in ("/api/stats", "/api/statistics"):
            anchor = parse_qs(parsed.query).get("anchor", [None])[0]
            self._json(build_stats(read_data(), anchor))
            return
        if path == "/api/export":
            kind = parse_qs(parsed.query).get("type", ["tasks"])[0]
            data = read_data()
            try:
                csv_text = _build_days_csv(data) if kind == "days" else _build_tasks_csv(data)
                kind = "days" if kind == "days" else "tasks"
            except (KeyError, TypeError, ValueError) as error:
                self._json({"error": f"导出失败: {error}"}, 500)
                return
            raw = csv_text.encode("utf-8-sig")
            filename = f"{kind}-{datetime.now().strftime('%Y%m%d')}.csv"
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f"attachment; filename=\"{filename}\"")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/goals":
            try:
                payload = self._body()
                if not isinstance(payload, dict):
                    raise ValueError("目标数据格式不正确")
                goal = _clean_goal(payload)
                if not goal["name"]:
                    self._json({"error": "目标名称不能为空"}, 400)
                    return
                data = read_data()
                data.setdefault("goals", []).append(goal)
                save_data(data)
                self._json(goal, 201)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "目标数据格式不正确"}, 400)
            return
        if path == "/api/ai/growth-report":
            try:
                payload = self._body()
                if not isinstance(payload, dict):
                    self._json({"error": "成长报告数据格式不正确"}, 400)
                    return
                report = _growth_report(payload)
                period = payload.get("period") if isinstance(payload.get("period"), dict) else {}
                start = str(period.get("start") or "").strip()
                end = str(period.get("end") or payload.get("anchor") or "").strip()
                if start and end:
                    report["period"] = {"start": start, "end": end, "label": period.get("label") or f"{start}—{end}"}
                    report["generatedAt"] = datetime.now().isoformat(timespec="seconds")
                    data = read_data()
                    reports = data.setdefault("growthReports", {})
                    if not isinstance(reports, dict):
                        reports = {}
                        data["growthReports"] = reports
                    reports[f"{start}:{end}"] = report
                    save_data(data)
                self._json({"report": report})
            except (json.JSONDecodeError, ValueError):
                self._json({"error": "成长报告数据格式不正确"}, 400)
            except RuntimeError as error:
                self._json({"error": str(error)}, 502)
            return
        if path == "/api/ai/review":
            try:
                payload = self._body()
                if not isinstance(payload, dict):
                    self._json({"error": "复盘内容格式不正确"}, 400)
                    return
                review = _ai_review(payload)
                self._json({"review": review})
            except (json.JSONDecodeError, ValueError):
                self._json({"error": "复盘内容格式不正确"}, 400)
            except RuntimeError as error:
                self._json({"error": str(error)}, 502)
            return
        if path == "/api/habits":
            try:
                payload = self._body()
                if not isinstance(payload, dict):
                    raise ValueError("习惯数据格式不正确")
                habit = _clean_habit(payload)
                if not habit["name"]:
                    self._json({"error": "习惯名称不能为空"}, 400)
                    return
                data = read_data()
                data.setdefault("habits", []).append(habit)
                save_data(data)
                self._json(habit, 201)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "习惯数据格式不正确"}, 400)
            return
        if path != "/api/tasks":
            self._json({"error": "Not found"}, 404)
            return
        payload = self._body()
        if not str(payload.get("title", "")).strip():
            self._json({"error": "任务名称不能为空"}, 400)
            return
        data = read_data()
        task = {
            "id": uuid.uuid4().hex,
            "title": str(payload.get("title", "")).strip(),
            "date": payload.get("date") or datetime.now().strftime("%Y-%m-%d"),
            "time": payload.get("time", ""),
            "category": payload.get("category", "工作"),
            "subcategory": payload.get("subcategory", ""),
            "type": str(payload.get("type") or payload.get("subcategory") or "").strip(),
            "sport_type": str(payload.get("sport_type") or payload.get("type") or payload.get("subcategory") or "").strip() if payload.get("category") == "健康" else "",
            "work_type": str(payload.get("work_type") or payload.get("type") or payload.get("subcategory") or "").strip() if payload.get("category") == "工作" else "",
            "duration": _clean_measurement(payload.get("duration")),
            "distance": _clean_measurement(payload.get("distance")),
            "count": _clean_measurement(payload.get("count")),
            "subject": str(payload.get("subject") or (payload.get("type") or payload.get("subcategory") or "") if payload.get("category") == "学习" else "").strip(),
            "project": str(payload.get("project") or "").strip(),
            "achievement": _clean_text(payload.get("achievement"), 500),
            "metrics": _clean_metrics(payload.get("metrics", {})),
            "priority": payload.get("priority", "normal"),
            "note": str(payload.get("note", "")).strip(),
            "done": bool(payload.get("done", False)),
            "habitId": str(payload.get("habitId") or "").strip(),
            "createdAt": datetime.now().isoformat(timespec="seconds"),
        }
        data.setdefault("tasks", []).append(task)
        save_data(data)
        self._json(task, 201)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/goals/"):
            goal_id = path.rsplit("/", 1)[-1]
            payload = self._body()
            if not isinstance(payload, dict):
                self._json({"error": "目标数据格式不正确"}, 400)
                return
            data = read_data()
            goal = next((item for item in data.get("goals", []) if item.get("id") == goal_id), None)
            if not goal:
                self._json({"error": "目标不存在"}, 404)
                return
            try:
                updated = _clean_goal(payload, goal)
                if not updated["name"]:
                    self._json({"error": "目标名称不能为空"}, 400)
                    return
            except (ValueError, TypeError) as error:
                self._json({"error": str(error) or "目标数据格式不正确"}, 400)
                return
            index = data["goals"].index(goal)
            data["goals"][index] = updated
            save_data(data)
            self._json(updated)
            return
        if path.startswith("/api/habits/"):
            habit_id = path.rsplit("/", 1)[-1]
            data = read_data()
            habits = data.setdefault("habits", [])
            index = next((i for i, item in enumerate(habits) if isinstance(item, dict) and item.get("id") == habit_id), None)
            if index is None:
                self._json({"error": "习惯不存在"}, 404)
                return
            try:
                payload = self._body()
                updated = _clean_habit(payload, habits[index])
                if not updated["name"]:
                    self._json({"error": "习惯名称不能为空"}, 400)
                    return
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "习惯数据格式不正确"}, 400)
                return
            habits[index] = updated
            save_data(data)
            self._json(updated)
            return
        if path.startswith("/api/days/"):
            date = path.rsplit("/", 1)[-1]
            payload = self._body()
            data = read_data()
            data.setdefault("dailyRecords", {})
            record = data["dailyRecords"].get(date, {})
            for key in ("special", "specialLabel", "breakfast", "lunch", "dinner", "weight", "expenseItems", "expense", "expenseNote", "incomeItems", "income", "incomeNote", "mood", "reviewHighlights", "reviewChallenges", "reviewGratitude", "reviewTomorrow", "reviewSummary", "generatedReview"):
                if key in payload:
                    record[key] = payload[key]
            if "expenseItems" in payload:
                record.pop("expense", None)
                record.pop("expenseNote", None)
            if "incomeItems" in payload:
                record.pop("income", None)
                record.pop("incomeNote", None)
            data["dailyRecords"][date] = record
            save_data(data)
            self._json({"date": date, **record})
            return
        if not path.startswith("/api/tasks/"):
            self._json({"error": "Not found"}, 404)
            return
        task_id = path.rsplit("/", 1)[-1]
        data = read_data()
        task = next((item for item in data.get("tasks", []) if item["id"] == task_id), None)
        if not task:
            self._json({"error": "任务不存在"}, 404)
            return
        payload = self._body()
        for key in ("title", "date", "time", "category", "subcategory", "type", "sport_type", "work_type", "duration", "distance", "count", "subject", "project", "achievement", "priority", "note", "done"):
            if key in payload:
                task[key] = payload[key]
        if "type" in payload:
            task["type"] = str(payload.get("type") or task.get("subcategory") or "").strip()
        if "sport_type" in payload:
            task["sport_type"] = str(payload.get("sport_type") or payload.get("type") or task.get("type") or "").strip()
        if "work_type" in payload:
            task["work_type"] = str(payload.get("work_type") or payload.get("type") or task.get("type") or "").strip()
        for key in ("duration", "distance", "count"):
            if key in payload:
                task[key] = _clean_measurement(payload.get(key))
        for key in ("subject", "project"):
            if key in payload:
                task[key] = str(payload.get(key) or "").strip()
        if "achievement" in payload:
            task["achievement"] = _clean_text(payload.get("achievement"), 500)
        if task.get("category") == "学习" and ("subject" in payload or "type" in payload or "subcategory" in payload):
            task["subject"] = str(payload.get("subject") or payload.get("type") or payload.get("subcategory") or "").strip()
        if "metrics" in payload:
            task["metrics"] = _clean_metrics(payload.get("metrics"))
        if not str(task.get("title", "")).strip():
            self._json({"error": "任务名称不能为空"}, 400)
            return
        save_data(data)
        self._json(task)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/goals/"):
            goal_id = path.rsplit("/", 1)[-1]
            data = read_data()
            before = len(data.get("goals", []))
            data["goals"] = [item for item in data.get("goals", []) if item.get("id") != goal_id]
            if len(data["goals"]) == before:
                self._json({"error": "目标不存在"}, 404)
                return
            save_data(data)
            self._json({"ok": True})
            return
        if path.startswith("/api/habits/"):
            habit_id = path.rsplit("/", 1)[-1]
            data = read_data()
            before = len(data.get("habits", []))
            data["habits"] = [item for item in data.get("habits", []) if not isinstance(item, dict) or item.get("id") != habit_id]
            if len(data["habits"]) == before:
                self._json({"error": "习惯不存在"}, 404)
                return
            save_data(data)
            self._json({"ok": True})
            return
        if not path.startswith("/api/tasks/"):
            self._json({"error": "Not found"}, 404)
            return
        task_id = path.rsplit("/", 1)[-1]
        data = read_data()
        before = len(data.get("tasks", []))
        data["tasks"] = [item for item in data.get("tasks", []) if item["id"] != task_id]
        if len(data["tasks"]) == before:
            self._json({"error": "任务不存在"}, 404)
            return
        save_data(data)
        self._json({"ok": True})

    def log_message(self, fmt, *args):
        # Keep the terminal useful without logging every static asset.
        if not self.path.startswith(("/static", "/favicon")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    import socket
    import sys
    # 优先级：命令行参数 > 环境变量 PORT > 默认 8000
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT") or PORT)
    # Serve this project even when the command is launched from another folder.
    import os
    os.chdir(ROOT)
    backup_data()
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        host_ip = probe.getsockname()[0]
        probe.close()
    except OSError:
        host_ip = socket.gethostbyname(socket.gethostname())
    print(f"每日清单已启动： http://localhost:{port}")
    print(f"局域网访问：     http://{host_ip}:{port}")
    print("数据保存在 data.json，按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
