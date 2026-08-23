#!/usr/bin/env python3
"""A tiny LAN-friendly server for the Daily List app."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path
import base64
import csv
import hashlib
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
ENGLISH_LEVELS = {"cet4": "大学英语四级", "cet6": "大学英语六级", "kaoyan": "考研英语", "ielts": "雅思", "daily": "日常英语"}
# 艾宾浩斯间隔重复：连续答对后下一次复习的间隔天数
SRS_INTERVALS = [1, 2, 4, 7, 15]
ENGLISH_FALLBACK_WORDS = [
    {"word": "abandon", "phonetic": "/əˈbændən/", "meaning": "vt. 放弃；抛弃", "example": "He abandoned the plan at the last minute.", "exampleTranslation": "他在最后一刻放弃了这个计划。"},
    {"word": "efficient", "phonetic": "/ɪˈfɪʃnt/", "meaning": "adj. 高效的", "example": "She is an efficient worker.", "exampleTranslation": "她是一名高效率的工作者。"},
    {"word": "reluctant", "phonetic": "/rɪˈlʌktənt/", "meaning": "adj. 不情愿的", "example": "He was reluctant to admit his mistake.", "exampleTranslation": "他不愿意承认自己的错误。"},
    {"word": "significant", "phonetic": "/sɪɡˈnɪfɪkənt/", "meaning": "adj. 重要的；显著的", "example": "There was a significant improvement in her grades.", "exampleTranslation": "她的成绩有了显著提高。"},
    {"word": "negotiate", "phonetic": "/nɪˈɡoʊʃieɪt/", "meaning": "v. 谈判；协商", "example": "They negotiated a lower price.", "exampleTranslation": "他们谈成了一个更低的价格。"},
    {"word": "persuade", "phonetic": "/pərˈsweɪd/", "meaning": "vt. 说服", "example": "She persuaded me to join the club.", "exampleTranslation": "她说服我加入了俱乐部。"},
    {"word": "consequence", "phonetic": "/ˈkɑːnsəkwens/", "meaning": "n. 后果；结果", "example": "Every choice has its consequences.", "exampleTranslation": "每个选择都有它的后果。"},
    {"word": "diligent", "phonetic": "/ˈdɪlɪdʒənt/", "meaning": "adj. 勤奋的", "example": "Diligent students review lessons every day.", "exampleTranslation": "勤奋的学生每天都复习功课。"},
    {"word": "estimate", "phonetic": "/ˈestɪmeɪt/", "meaning": "v. 估计；估算", "example": "I estimate it will take two hours.", "exampleTranslation": "我估计这需要两个小时。"},
    {"word": "genuine", "phonetic": "/ˈdʒenjuɪn/", "meaning": "adj. 真诚的；真正的", "example": "She showed genuine interest in my idea.", "exampleTranslation": "她对我的想法表现出真诚的兴趣。"},
    {"word": "implement", "phonetic": "/ˈɪmplɪment/", "meaning": "vt. 实施；执行", "example": "The school implemented a new schedule.", "exampleTranslation": "学校实施了一份新的时间表。"},
    {"word": "overcome", "phonetic": "/ˌoʊvərˈkʌm/", "meaning": "vt. 克服", "example": "He overcame his fear of speaking.", "exampleTranslation": "他克服了说话的恐惧。"},
]
ENGLISH_FALLBACK_SENTENCES = [
    {"text": "Practice makes progress, not perfection.", "translation": "练习带来的是进步，而不是完美。", "points": ["make progress 固定搭配：取得进步", "not perfection 与 progress 形成对比强调"]},
    {"text": "A little effort every day adds up to something big.", "translation": "每天一点点努力，累积起来就是大成就。", "points": ["add up to：累计达到", "a little + 不可数名词 effort"]},
    {"text": "The best time to start was yesterday; the next best time is now.", "translation": "开始的最好时间是昨天，其次是现在。", "points": ["the best time to do sth 句型", "分号连接两个并列分句"]},
]

GOAL_CATEGORIES = {"健康", "学习", "工作", "生活", "减肥"}
GOAL_METRICS = {
    "健康": {"distance": "公里", "duration": "小时", "completedCount": "次"},
    "学习": {"duration": "小时", "completedCount": "次"},
    "工作": {"completedCount": "个", "duration": "小时"},
    "生活": {"completedCount": "个", "duration": "小时"},
    "减肥": {"weight": "kg"},
}


DEFAULT_DATA = {"tasks": [], "dailyRecords": {}, "goals": [], "habits": [], "growthReports": {}, "english": {}, "settings": {"name": "我的每日清单"}}


def read_data():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_DATA))
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = json.loads(json.dumps(DEFAULT_DATA))
    if not isinstance(data.get("english"), dict):
        data["english"] = {}
    return data


def _english_store(data):
    """确保 english 数据结构完整，返回引用。"""
    store = data.setdefault("english", {})
    if not isinstance(store, dict):
        store = {}
        data["english"] = store
    for key in ("plans", "words", "wrongWords", "log", "favorites", "weeklyReports"):
        if not isinstance(store.get(key), dict):
            store[key] = {}
    if not isinstance(store.get("sessions"), list):
        store["sessions"] = []
    return store


def _today_str():
    return datetime.now().strftime("%Y-%m-%d")


def _touch_english_log(store, date, **fields):
    log = store["log"].setdefault(date, {"newWords": 0, "correct": 0, "wrong": 0, "speakingMessages": 0})
    for key, value in fields.items():
        log[key] = int(log.get(key) or 0) + value
    cutoff = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    for old_date in [key for key in store["log"] if str(key) < cutoff]:
        del store["log"][old_date]
    return log


def _build_english_csv(data):
    store = _english_store(data)
    import csv as _csv
    buf = io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["单词", "音标", "释义", "例句", "例句翻译", "状态", "加入时间", "复习次数", "答对", "答错", "记忆阶段", "下次复习"])
    for entry in sorted(store["words"].values(), key=lambda w: str(w.get("addedAt") or "")):
        writer.writerow([entry.get("word", ""), entry.get("phonetic", ""), entry.get("meaning", ""),
                         entry.get("example", ""), entry.get("exampleTranslation", ""),
                         "已掌握" if entry.get("status") == "mastered" else "学习中",
                         str(entry.get("addedAt") or "")[:10], entry.get("reviewCount", 0),
                         entry.get("correctCount", 0), entry.get("wrongCount", 0),
                         entry.get("stage", 0), entry.get("nextReviewAt", "")])
    return buf.getvalue()


def _clean_word_entry(raw):
    if not isinstance(raw, dict):
        return None
    word = str(raw.get("word") or "").strip()
    if not word or len(word) > 60:
        return None
    return {
        "word": word,
        "phonetic": str(raw.get("phonetic") or "").strip()[:80],
        "meaning": _clean_text(raw.get("meaning"), 200),
        "example": _clean_text(raw.get("example"), 300),
        "exampleTranslation": _clean_text(raw.get("exampleTranslation"), 300),
    }


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


def _local_english_plan(payload):
    """无 API Key 时的本地词库计划，保证功能离线可用。"""
    level = payload.get("level") if payload.get("level") in ENGLISH_LEVELS else "cet4"
    seed = sum(int(ch) for ch in str(payload.get("date") or _today_str()) if ch.isdigit())
    pool = [dict(item) for item in ENGLISH_FALLBACK_WORDS]
    recent = {str(w).lower() for w in (payload.get("recentWords") or []) if w}
    if recent:
        filtered = [item for item in pool if item["word"].lower() not in recent]
        if filtered:
            pool = filtered
    words = []
    seen_words = set()
    def _take(entry):
        if entry and entry["word"].lower() not in seen_words:
            seen_words.add(entry["word"].lower())
            words.append(entry)
    for item in (payload.get("dueWords") or [])[:3]:
        _take(_clean_word_entry(item))
    wrong = payload.get("wrongWords") if isinstance(payload.get("wrongWords"), list) else []
    for item in wrong[:2]:
        _take(_clean_word_entry(item))
    index = seed % len(pool)
    while len(words) < 6 and pool:
        _take(pool.pop(index % len(pool)))
        index += 3
    sentence = dict(ENGLISH_FALLBACK_SENTENCES[seed % len(ENGLISH_FALLBACK_SENTENCES)])
    return {
        "level": level,
        "words": words,
        "sentence": sentence,
        "speaking": {"topic": "Talk about your plan for this weekend", "scene": "和朋友闲聊", "starter": "I'm thinking about..."},
        "tip": "先读一遍单词和例句，再遮住中文自测；不确定的单词点“不认识”加入错词本。",
        "source": "local",
    }


def _english_plan_ai(payload, api_key, config):
    api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
    model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
    level_label = ENGLISH_LEVELS.get(payload.get("level"), ENGLISH_LEVELS["cet4"])
    focus = _clean_text(payload.get("focus"), 100)
    wrong = payload.get("wrongWords") if isinstance(payload.get("wrongWords"), list) else []
    due = payload.get("dueWords") if isinstance(payload.get("dueWords"), list) else []
    recent = [str(w) for w in (payload.get("recentWords") or [])][:20]
    seen_names = set()
    review_names = []
    for item in due + wrong:
        name = _clean_text(item if isinstance(item, str) else (item or {}).get("word"), 40)
        if name and name.lower() not in seen_names:
            seen_names.add(name.lower())
            review_names.append(name)
    review_names_text = "、".join(review_names[:8])
    recent_text = "、".join(recent)
    system = (
        "你是一名专业的AI英语教练，为中国学习者设计每日英语学习任务。"
        f"目标水平：{level_label}。" + (f"用户希望重点练习：{focus}。" if focus else "")
        + (f"以下是用户到期需要复习的单词，请优先安排其中2-4个：{review_names_text}。" if review_names_text else "")
        + (f"不要选用这些最近7天已学过的单词：{recent_text}。" if recent_text else "")
        + "必须严格返回 JSON，不要 Markdown，字段为："
          "words（恰好6个单词的对象数组，每项含 word、phonetic（音标）、meaning（中文释义）、example（英文例句）、exampleTranslation（例句中文翻译）），"
          "sentence（对象，含 text（地道英文句子）、translation（中文翻译）、points（1-3条语法/搭配要点的字符串数组）），"
          "speaking（对象，含 topic（口语话题，英文）、scene（场景说明，中文）、starter（开场句，英文）），"
          "tip（一条简短的中文学习方法建议）。"
          "单词不要编造不存在的词，例句要贴近生活、难度符合目标水平。"
    )
    body = json.dumps({"model": model, "temperature": 0.6, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": f"请生成 {payload.get('date') or '今天'} 的英语学习任务"}]}).encode("utf-8")
    request = urllib.request.Request(api_url, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read().decode("utf-8"))
    plan = _parse_ai_json(result["choices"][0]["message"]["content"])
    if not isinstance(plan, dict):
        raise ValueError("返回格式不正确")
    words = [_clean_word_entry(item) for item in (plan.get("words") or [])]
    words = [item for item in words if item][:10]
    if len(words) < 3:
        raise ValueError("AI 返回的单词不足")
    sentence_raw = plan.get("sentence") if isinstance(plan.get("sentence"), dict) else {}
    speaking_raw = plan.get("speaking") if isinstance(plan.get("speaking"), dict) else {}
    points = [str(p)[:120] for p in (sentence_raw.get("points") or [])][:3]
    return {
        "level": payload.get("level") if payload.get("level") in ENGLISH_LEVELS else "cet4",
        "words": words,
        "sentence": {"text": _clean_text(sentence_raw.get("text"), 300), "translation": _clean_text(sentence_raw.get("translation"), 300), "points": points},
        "speaking": {"topic": _clean_text(speaking_raw.get("topic"), 200) or "Free talk", "scene": _clean_text(speaking_raw.get("scene"), 100), "starter": _clean_text(speaking_raw.get("starter"), 200)},
        "tip": _clean_text(plan.get("tip"), 300),
        "source": "ai",
    }


def build_english_plan(payload):
    """生成每日英语计划：优先 AI，失败自动回退本地词库。"""
    date = str(payload.get("date") or _today_str()).strip()
    config = load_config()
    api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
    plan = None
    if api_key:
        try:
            plan = _english_plan_ai({**payload, "date": date}, api_key, config)
        except Exception:  # noqa: BLE001 - AI 失败时回退本地词库
            plan = None
    if plan is None:
        plan = _local_english_plan({**payload, "date": date})
    plan["date"] = date
    plan["generatedAt"] = datetime.now().isoformat(timespec="seconds")
    plan.setdefault("completed", False)
    return plan


def _english_speak_local(message):
    replies = [
        "Good try! Could you say that again using a full sentence? For example: “I think ... because ...”",
        "Nice effort! Let's practice more. Try answering: Why do you think so?",
        "Great! Can you add one more detail to your answer?",
    ]
    seed = sum(ord(ch) for ch in message) % len(replies)
    return {"reply": replies[seed], "corrections": [], "source": "local"}


def _english_speak(payload, api_key, config):
    api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
    model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
    topic = _clean_text(payload.get("topic"), 100) or "Free talk"
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    messages = [{"role": "system", "content": (
        "你是一名友好、有耐心的AI英语口语教练。当前话题：" + topic + "。规则："
        "1）始终用简单清晰的英文回复（B1 水平，1-4句话），像聊天一样自然推进对话，可以适当追问；"
        "2）如果用户的英文有语法/用词/拼写错误，在 corrections 里指出，没有错误则 corrections 为空数组；"
        "3）用户用中文表达时，鼓励并教他对应的英文说法；"
        "4）必须严格返回 JSON，不要 Markdown，字段为：reply（你的英文回复）、"
        "corrections（对象数组，每项含 original（用户原句片段）、suggestion（改正后）、explanation（中文简短解释））。"
    )}]
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = "assistant" if item.get("role") == "coach" else "user"
        content = _clean_text(item.get("content"), 800)
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": _clean_text(payload.get("message"), 800)})
    body = json.dumps({"model": model, "temperature": 0.7, "response_format": {"type": "json_object"},
                       "messages": messages}).encode("utf-8")
    request = urllib.request.Request(api_url, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read().decode("utf-8"))
    reply_data = _parse_ai_json(result["choices"][0]["message"]["content"])
    if isinstance(reply_data, str):
        reply_data = {"reply": reply_data}
    if not isinstance(reply_data, dict) or not str(reply_data.get("reply", "")).strip():
        raise ValueError("回复格式不正确")
    corrections = []
    for item in (reply_data.get("corrections") or [])[:3]:
        if isinstance(item, dict) and str(item.get("suggestion") or "").strip():
            corrections.append({"original": _clean_text(item.get("original"), 200), "suggestion": _clean_text(item.get("suggestion"), 200), "explanation": _clean_text(item.get("explanation"), 200)})
    return {"reply": _clean_text(reply_data.get("reply"), 1500), "corrections": corrections, "source": "ai"}


def _english_weekly_stats(store):
    week_start = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")
    logs = [log for day, log in store["log"].items() if str(day) >= week_start]
    new_words = sum(int(l.get("newWords") or 0) for l in logs)
    correct = sum(int(l.get("correct") or 0) for l in logs)
    wrong = sum(int(l.get("wrong") or 0) for l in logs)
    speaking = sum(int(l.get("speakingMessages") or 0) for l in logs)
    plan_days = sum(1 for l in logs if int(l.get("planCompleted") or 0) > 0)
    words = list(store["words"].values())
    active_wrong = [w for w in store["wrongWords"].values() if isinstance(w, dict) and not w.get("mastered")]
    return {"weekStart": week_start, "newWords": new_words, "correct": correct, "wrong": wrong,
            "speakingMessages": speaking, "planDays": plan_days,
            "totalWords": len(words), "mastered": len([w for w in words if w.get("status") == "mastered"]),
            "activeWrong": len(active_wrong),
            "topWrong": sorted([w.get("word") for w in active_wrong], key=lambda x: x or "")[:5]}


def _english_weekly_report_ai(stats, api_key, config):
    api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
    model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
    system = (
        "你是一名暖心的英语学习教练，根据数据用中文写一份简短周报。"
        "必须严格返回 JSON：summary（本周表现总结，120字内，引用具体数字）、"
        "advice（2条改进建议的字符串数组）、encouragement（一句话鼓励）。"
    )
    body = json.dumps({"model": model, "temperature": 0.7, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": json.dumps(stats, ensure_ascii=False)}]}).encode("utf-8")
    request = urllib.request.Request(api_url, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read().decode("utf-8"))
    report = _parse_ai_json(result["choices"][0]["message"]["content"])
    if not isinstance(report, dict) or not str(report.get("summary") or "").strip():
        raise ValueError("返回格式不正确")
    return {"summary": _clean_text(report.get("summary"), 400),
            "advice": [str(a)[:150] for a in (report.get("advice") or [])][:2],
            "encouragement": _clean_text(report.get("encouragement"), 100), "source": "ai"}


def _english_weekly_report_local(stats):
    accuracy = f"{round(stats['correct'] / (stats['correct'] + stats['wrong']) * 100)}%" if stats["correct"] + stats["wrong"] else "暂无"
    summary = (f"本周新学 {stats['newWords']} 个单词，复习正确率 {accuracy}，口语练习 {stats['speakingMessages']} 条消息，"
               f"完成每日任务 {stats['planDays']} 天。词库累计 {stats['totalWords']} 词（已掌握 {stats['mastered']}），待消灭错词 {stats['activeWrong']} 个。")
    advice = []
    if stats["wrong"] > stats["correct"]:
        advice.append("答错偏多，建议先用“听音拼写”慢速过一遍错词本再做题。")
    if stats["speakingMessages"] == 0:
        advice.append("本周还没开口练口语，挑一个话题和 AI 教练聊五分钟。")
    if not advice:
        advice.append("节奏很稳，下周可以尝试提高目标水平或加一次听音拼写。")
    advice.append(f"重点关照错词：{('、'.join(stats['topWrong'])) if stats['topWrong'] else '暂无'}。")
    return {"summary": summary, "advice": advice[:2], "encouragement": "坚持就是胜利，下周继续！", "source": "local"}


class AppHandler(SimpleHTTPRequestHandler):
    def _check_auth(self):
        """局域网访问口令（HTTP Basic Auth），在 config.json 的 access_password 配置，留空则不启用"""
        password = str(load_config().get("access_password", "")).strip()
        if not password:
            return True
        expected = "Basic " + base64.b64encode(f"user:{password}".encode()).decode()
        header = self.headers.get("Authorization", "")
        if header == expected:
            return True
        # 兼容任意用户名：只校验密码部分
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode("utf-8", "ignore")
                if ":" in decoded and decoded.split(":", 1)[1] == password:
                    return True
            except Exception:
                pass
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Daily Checklist"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

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
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/config.json":
            self._json({"error": "Not found"}, 404)
            return
        if path == "/api/state":
            self._json(read_data())
            return
        if path == "/api/english/sessions":
            store = _english_store(read_data())
            sessions = [dict(item, messages=(item.get("messages") or [])[-50:])
                        for item in store["sessions"][:10] if isinstance(item, dict)]
            self._json({"sessions": sessions})
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
                if kind == "english-words":
                    csv_text = _build_english_csv(data)
                else:
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
        if not self._check_auth():
            return
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
        if path == "/api/english/plan":
            try:
                payload = self._body()
                if not isinstance(payload, dict):
                    raise ValueError("参数格式不正确")
                data = read_data()
                store = _english_store(data)
                anchor_date = str(payload.get("date") or _today_str())
                payload["wrongWords"] = [item for item in store["wrongWords"].values() if isinstance(item, dict) and not item.get("mastered")]
                recent_cutoff = (datetime.strptime(anchor_date, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
                payload["recentWords"] = sorted({str(e.get("word")) for e in store["words"].values()
                                                 if isinstance(e, dict) and str(e.get("addedAt") or "")[:10] > recent_cutoff})
                payload["dueWords"] = [{**e} for e in store["words"].values()
                                       if isinstance(e, dict) and e.get("status") != "mastered"
                                       and str(e.get("nextReviewAt") or "9999-99-99") <= anchor_date]
                plan = build_english_plan(payload)
                date = plan["date"]
                old_plan = store["plans"].get(date) if isinstance(store["plans"].get(date), dict) else {}
                known = {word.lower() for word in store["words"]}
                new_entries = []
                for entry in plan.get("words", []):
                    key = entry["word"].lower()
                    if key not in known:
                        store["words"][key] = {**entry, "addedAt": datetime.now().isoformat(timespec="seconds"), "reviewCount": 0, "correctCount": 0, "wrongCount": 0, "lastReviewAt": "", "status": "learning", "stage": 0, "nextReviewAt": ""}
                        new_entries.append(store["words"][key])
                        known.add(key)
                new_count = len(new_entries)
                plan["completed"] = bool(old_plan.get("completed")) and old_plan.get("words") == plan.get("words")
                store["plans"][date] = plan
                _touch_english_log(store, date, newWords=new_count)
                save_data(data)
                self._json({"plan": plan, "newWords": new_count, "newWordEntries": new_entries})
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "计划生成失败"}, 400)
            return
        if path == "/api/english/words/review":
            try:
                payload = self._body()
                word_key = str(payload.get("word") or "").strip().lower()
                result = "wrong" if payload.get("result") == "wrong" else "correct"
                data = read_data()
                store = _english_store(data)
                entry = store["words"].get(word_key)
                if not entry:
                    self._json({"error": "该单词不在词库中"}, 404)
                    return
                now_iso = datetime.now().isoformat(timespec="seconds")
                entry["reviewCount"] = int(entry.get("reviewCount") or 0) + 1
                entry["lastReviewAt"] = now_iso
                if result == "correct":
                    entry["correctCount"] = int(entry.get("correctCount") or 0) + 1
                    entry["status"] = "mastered" if entry["correctCount"] >= 3 else "learning"
                    next_stage = int(entry.get("stage") or 0) + 1
                    entry["stage"] = min(next_stage, len(SRS_INTERVALS))
                    interval = SRS_INTERVALS[min(next_stage, len(SRS_INTERVALS)) - 1]
                    entry["nextReviewAt"] = (datetime.now() + timedelta(days=interval)).strftime("%Y-%m-%d")
                    removed = store["wrongWords"].pop(word_key, None) is not None
                    _touch_english_log(store, _today_str(), correct=1)
                else:
                    entry["wrongCount"] = int(entry.get("wrongCount") or 0) + 1
                    entry["status"] = "learning"
                    entry["stage"] = 0
                    entry["nextReviewAt"] = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
                    wrong_entry = store["wrongWords"].get(word_key) or {"word": entry.get("word", payload.get("word")), "meaning": entry.get("meaning", ""), "reason": str(payload.get("reason") or "").strip()[:200]}
                    wrong_entry["wrongCount"] = int(wrong_entry.get("wrongCount") or 0) + 1
                    wrong_entry["lastWrongAt"] = now_iso
                    wrong_entry["mastered"] = False
                    if payload.get("reason"):
                        wrong_entry["reason"] = str(payload.get("reason")).strip()[:200]
                    store["wrongWords"][word_key] = wrong_entry
                    _touch_english_log(store, _today_str(), wrong=1)
                save_data(data)
                self._json({"word": entry})
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "记录失败"}, 400)
            return
        if path == "/api/english/words":
            try:
                payload = self._body()
                entry = _clean_word_entry(payload)
                if not entry:
                    self._json({"error": "单词不能为空"}, 400)
                    return
                data = read_data()
                store = _english_store(data)
                key = entry["word"].lower()
                existing = store["words"].get(key)
                if existing:
                    existing.update({k: v for k, v in entry.items() if v})
                    word_result = existing
                else:
                    store["words"][key] = {**entry, "addedAt": datetime.now().isoformat(timespec="seconds"), "reviewCount": 0, "correctCount": 0, "wrongCount": 0, "lastReviewAt": "", "status": "learning", "stage": 0, "nextReviewAt": ""}
                    word_result = store["words"][key]
                    _touch_english_log(store, _today_str(), newWords=1)
                save_data(data)
                self._json(word_result, 201)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "单词格式不正确"}, 400)
            return
        if path == "/api/english/words/import":
            try:
                payload = self._body()
                raw = payload.get("words") if isinstance(payload.get("words"), list) else []
                names, seen = [], set()
                for item in raw[:60]:
                    name = str(item).strip()[:40]
                    key = name.lower()
                    if name and re.fullmatch(r"[a-zA-Z'\- ]{1,40}", name) and key not in seen:
                        seen.add(key)
                        names.append(name)
                names = names[:30]
                if not names:
                    self._json({"error": "请提供要导入的单词（每行一个）"}, 400)
                    return
                entries = None
                config = load_config()
                api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
                if api_key:
                    try:
                        api_url = config.get("deepseek_api_url") or DEFAULT_DEEPSEEK_URL
                        model = config.get("deepseek_model") or DEFAULT_DEEPSEEK_MODEL
                        system = ("你是英语词典助手。为下列单词逐个提供信息，必须严格返回 JSON："
                                  "{\"words\":[{\"word\",\"phonetic\"（音标）,\"meaning\"（中文释义）,\"example\"（英文例句）,\"exampleTranslation\"（例句中文翻译）}]}。"
                                  "只处理给定的词，不要编造不存在的词。")
                        body = json.dumps({"model": model, "temperature": 0.3, "response_format": {"type": "json_object"},
                                           "messages": [{"role": "system", "content": system},
                                                        {"role": "user", "content": "、".join(names)}]}).encode("utf-8")
                        req = urllib.request.Request(api_url, data=body, headers={
                            "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
                        with urllib.request.urlopen(req, timeout=90) as response:
                            result = json.loads(response.read().decode("utf-8"))
                        parsed = _parse_ai_json(result["choices"][0]["message"]["content"])
                        cand = [_clean_word_entry(w) for w in (parsed or {}).get("words", [])] if isinstance(parsed, dict) else []
                        cand = [w for w in cand if w]
                        got = {str(w.get("word") or "").lower() for w in cand}
                        if len([n for n in names if n.lower() in got]) >= max(1, int(len(names) * 0.6)):
                            entries = {str(w["word"]).lower(): w for w in cand}
                    except Exception:  # noqa: BLE001 - AI 失败时回退本地导入
                        entries = None
                if entries is None:
                    entries = {}
                data = read_data()
                store = _english_store(data)
                saved, now_iso = [], datetime.now().isoformat(timespec="seconds")
                for name in names:
                    key = name.lower()
                    if key in store["words"]:
                        continue
                    base = dict(entries.get(key) or {"word": name})
                    base["word"] = name
                    store["words"][key] = {**base, "addedAt": now_iso, "reviewCount": 0, "correctCount": 0,
                                           "wrongCount": 0, "lastReviewAt": "", "status": "learning", "stage": 0, "nextReviewAt": ""}
                    saved.append(store["words"][key])
                _touch_english_log(store, _today_str(), newWords=len(saved))
                save_data(data)
                self._json({"imported": len(saved), "skipped": len(names) - len(saved), "entries": saved}, 201)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "导入失败"}, 400)
            return
        if path == "/api/english/weekly-report":
            try:
                data = read_data()
                store = _english_store(data)
                stats = _english_weekly_stats(store)
                report = None
                config = load_config()
                api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
                if api_key:
                    try:
                        report = _english_weekly_report_ai(stats, api_key, config)
                    except Exception:  # noqa: BLE001 - AI 失败时回退本地模板
                        report = None
                if report is None:
                    report = _english_weekly_report_local(stats)
                anchor = stats["weekStart"]
                report.update(stats)
                report["generatedAt"] = datetime.now().isoformat(timespec="seconds")
                store["weeklyReports"][anchor] = report
                del_keys = sorted(store["weeklyReports"].keys())[:-8]
                for old in del_keys:
                    del store["weeklyReports"][old]
                save_data(data)
                self._json(report)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "周报生成失败"}, 400)
            return
        if path == "/api/english/plan/complete":
            try:
                payload = self._body()
                date = str(payload.get("date") or _today_str()).strip()
                data = read_data()
                store = _english_store(data)
                plan = store["plans"].get(date)
                if not isinstance(plan, dict):
                    self._json({"error": "该日期还没有英语任务，请先生成"}, 404)
                    return
                completed = bool(payload.get("completed"))
                plan["completed"] = completed
                if completed:
                    plan["completedAt"] = datetime.now().isoformat(timespec="seconds")
                else:
                    plan.pop("completedAt", None)
                log = _touch_english_log(store, date, planCompleted=1 if completed else -1)
                log["planCompleted"] = max(0, int(log.get("planCompleted") or 0))
                save_data(data)
                self._json({"date": date, "completed": completed})
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "操作失败"}, 400)
            return
        if path == "/api/english/sentence-favs":
            try:
                payload = self._body()
                text = _clean_text(payload.get("text"), 300)
                if not text:
                    self._json({"error": "句子不能为空"}, 400)
                    return
                data = read_data()
                store = _english_store(data)
                key = hashlib.md5(text.strip().lower().encode("utf-8")).hexdigest()[:12]
                if key in store["favorites"]:
                    del store["favorites"][key]
                    save_data(data)
                    self._json({"saved": False})
                    return
                store["favorites"][key] = {"key": key, "text": text,
                                           "translation": _clean_text(payload.get("translation"), 300),
                                           "points": [str(p)[:120] for p in (payload.get("points") or []) if str(p).strip()][:3],
                                           "date": str(payload.get("date") or _today_str())[:10],
                                           "level": str(payload.get("level") or "")[:10],
                                           "addedAt": datetime.now().isoformat(timespec="seconds")}
                save_data(data)
                self._json({"saved": True, "favorite": store["favorites"][key]}, 201)
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "收藏失败"}, 400)
            return
        if path == "/api/english/speaking":
            try:
                payload = self._body()
                message = _clean_text(payload.get("message"), 800)
                if not message:
                    self._json({"error": "请输入要说的话"}, 400)
                    return
                topic = _clean_text(payload.get("topic"), 100) or "Free talk"
                config = load_config()
                api_key = config.get("deepseek_api_key") or os.environ.get("DEEPSEEK_API_KEY")
                reply = None
                if api_key:
                    try:
                        reply = _english_speak(payload, api_key, config)
                    except Exception:  # noqa: BLE001 - AI 失败时回退本地回复
                        reply = None
                if reply is None:
                    reply = _english_speak_local(message)
                data = read_data()
                store = _english_store(data)
                session_id = str(payload.get("sessionId") or "").strip()
                session = next((item for item in store["sessions"] if item.get("id") == session_id), None)
                if session is None:
                    session_id = uuid.uuid4().hex
                    session = {"id": session_id, "date": _today_str(), "topic": topic, "createdAt": datetime.now().isoformat(timespec="seconds"), "messages": []}
                    store["sessions"].insert(0, session)
                del store["sessions"][20:]
                session["topic"] = topic
                session.setdefault("messages", []).append({"role": "user", "content": message, "at": datetime.now().isoformat(timespec="seconds")})
                session["messages"].append({"role": "coach", "content": reply["reply"], "corrections": reply.get("corrections", []), "at": datetime.now().isoformat(timespec="seconds")})
                del session["messages"][:-200]
                _touch_english_log(store, _today_str(), speakingMessages=2)
                save_data(data)
                self._json({"id": session_id, **reply})
            except (json.JSONDecodeError, ValueError, TypeError) as error:
                self._json({"error": str(error) or "口语练习请求失败"}, 400)
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
        if not self._check_auth():
            return
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
        if path.startswith("/api/english/wrong-words/"):
            word_key = unquote(path.rsplit("/", 1)[-1]).lower()
            data = read_data()
            store = _english_store(data)
            entry = store["wrongWords"].get(word_key)
            if not entry:
                self._json({"error": "错词不存在"}, 404)
                return
            payload = self._body()
            entry["mastered"] = bool(payload.get("mastered"))
            save_data(data)
            self._json(entry)
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
        if not self._check_auth():
            return
        path = urlparse(self.path).path
        if path.startswith("/api/english/sentence-favs/"):
            fav_key = unquote(path.rsplit("/", 1)[-1])
            data = read_data()
            store = _english_store(data)
            if fav_key not in store["favorites"]:
                self._json({"error": "收藏不存在"}, 404)
                return
            del store["favorites"][fav_key]
            save_data(data)
            self._json({"ok": True})
            return
        if path.startswith("/api/english/words/"):
            word_key = unquote(path.rsplit("/", 1)[-1]).lower()
            data = read_data()
            store = _english_store(data)
            removed_word = store["words"].pop(word_key, None) is not None
            removed_wrong = store["wrongWords"].pop(word_key, None) is not None
            if not (removed_word or removed_wrong):
                self._json({"error": "单词不存在"}, 404)
                return
            save_data(data)
            self._json({"ok": True})
            return
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
