# -*- coding: utf-8 -*-
"""pi 微信推送小助手：读写每日清单 data.json
命令:
  today   超级早报（天气+倒计时+今日任务+昨日回顾）
  pending 晚间收尾（未完成+消费/体重+预算/体重警报+复盘检查）
  weekly  周报（本周统计+AI点评）
  gen     把周期模板生成为今日任务（同日同名跳过）
  day [--date D]                  查看任意一天
  add 标题 [--date D] [--time T] [--category C]
  done 关键词 [--date D]          完成匹配任务
  del 关键词 [--date D]           删除匹配任务
  rec 早|午|晚|体重|支出|收入 值 [备注] [--date D]
"""
import sys, json, uuid, argparse, io, urllib.request
from datetime import datetime, date, timedelta
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BASE = Path(__file__).resolve().parent
DATA = BASE / "data.json"
CFG_FILE = BASE / "config.json"

CITY, LAT, LON = "武汉", 30.59, 114.31  # 天气定位（可改）
CAT_EMOJI = {"健康": "🏃", "学习": "📚", "工作": "💼", "生活": "🏠", "其他": "📌"}
WEEKDAY = "一二三四五六日"
MEAL_KEYS = {"早": "breakfast", "早餐": "breakfast", "午": "lunch", "午餐": "lunch",
             "晚": "dinner", "晚餐": "dinner", "晚饭": "dinner"}
WEATHER_CODES = {0: "晴 ☀️", 1: "多云转晴 🌤", 2: "多云 ⛅", 3: "阴 ☁️", 45: "雾 🌫", 48: "雾凇 🌫",
                 51: "小毛毛雨 🌦", 53: "毛毛雨 🌦", 55: "大毛毛雨 🌦", 61: "小雨 🌧", 63: "中雨 🌧",
                 65: "大雨 🌧", 71: "小雪 ❄️", 73: "中雪 ❄️", 75: "大雪 ❄️", 80: "阵雨 🌦",
                 81: "阵雨 🌧", 82: "强阵雨 ⛈", 95: "雷雨 ⛈", 96: "雷雨伴冰雹 ⛈", 99: "雷雨伴冰雹 ⛈"}


# ---------- 基础 ----------

def load():
    if not DATA.exists():
        return {"tasks": [], "dailyRecords": {}}
    return json.loads(DATA.read_text(encoding="utf-8"))


def save(data):
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DATA)


def load_cfg():
    try:
        return json.loads(CFG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def iso(d):
    return d.isoformat() if isinstance(d, date) else str(d)


def weekday_cn(day_str):
    return WEEKDAY[date.fromisoformat(str(day_str)).weekday()]


def tasks_of(data, day):
    ts = [t for t in data.get("tasks", []) if t.get("date") == str(day)]
    ts.sort(key=lambda t: (t.get("time") or "99:99", t.get("done", False)))
    return ts


def new_task(title, day, time_="", category="其他", priority="normal", **extra):
    fields = dict(subcategory="", type="", sport_type="", duration="",
                  distance="", count="", subject="", project="")
    for k, v in extra.items():
        if k in fields:
            fields[k] = str(v)
    task = {"id": uuid.uuid4().hex, "title": title, "date": str(day), "time": time_,
            "category": category if category in CAT_EMOJI else "其他",
            "priority": priority or "normal", "note": "", "done": False,
            "createdAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "metrics": {}}
    task.update(fields)
    return task


def fmt_list(ts):
    out = []
    for t in ts:
        mark = "✅" if t.get("done") else "⬜"
        tm = f"{t['time']} " if t.get("time") else ""
        pr = "❗" if t.get("priority") == "high" else ""
        icon = CAT_EMOJI.get(t.get("category", ""), "📌")
        out.append(f"{mark} {tm}{icon} {t.get('title', '')}{pr}")
    return out


def match_tasks(data, kw, day):
    kw = kw.lower()
    return [t for t in tasks_of(data, day) if kw in str(t.get("title", "")).lower()]


# ---------- 记录摘要 ----------

def expenses_of(rec):
    items = rec.get("expenseItems")
    if not items and str(rec.get("expense", "")).strip():  # 兼容旧数据
        items = [{"amount": float(rec["expense"]), "note": ""}]
    return items or []


def money_of(rec):
    items = expenses_of(rec)
    notes = [i.get("note") for i in items if i.get("note")]
    return sum(float(i.get("amount", 0)) for i in items), \
        sum(float(i.get("amount", 0)) for i in rec.get("incomeItems", [])), notes


def month_expense(data, today_iso):
    month = today_iso[:7]
    return sum(money_of(r)[0] for d, r in data.get("dailyRecords", {}).items()
               if str(d).startswith(month))


def weight_points(data, before=None):
    """[(日期, 体重)] 按日期升序，before 传 ISO 日期表示只取当天及之前"""
    pts = []
    for d in sorted(data.get("dailyRecords", {}).keys()):
        w = str(data["dailyRecords"][d].get("weight", "")).strip()
        if w and (not before or d <= before):
            try:
                pts.append((d, float(w)))
            except ValueError:
                pass
    return pts


def has_review(rec):
    return any(rec.get(k) for k in ("reviewSummary", "reviewHighlights"))


def day_summary(data, day):
    """某天的消费/体重/饮食摘要行"""
    rec = data.get("dailyRecords", {}).get(str(day), {})
    parts = []
    exp, inc, notes = money_of(rec)
    if exp or inc:
        line = f"💰 支出 ¥{exp:g}" + (f" · 收入 ¥{inc:g}" if inc else "")
        if notes:
            line += "（" + "、".join(notes) + "）"
        parts.append(line)
    if str(rec.get("weight", "")).strip():
        parts.append(f"⚖️ 体重 {rec['weight']}kg")
    meals = [f"{label} {rec[key]}" for label, key in (("早", "breakfast"), ("午", "lunch"), ("晚", "dinner"))
             if rec.get(key)]
    if meals:
        parts.append("🍽️ " + " | ".join(meals))
    return parts, rec


# ---------- 提示行 ----------

def get_weather():
    try:
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
               "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
               "precipitation_probability_max&timezone=auto&forecast_days=1")
        with urllib.request.urlopen(url, timeout=6) as r:
            daily = json.loads(r.read().decode())["daily"]
        w = WEATHER_CODES.get(int(daily["weather_code"][0]), "")
        pp = daily["precipitation_probability_max"][0] or 0
        rain = f"，降雨概率{pp}%" if pp >= 40 else ""
        return f"{w} {daily['temperature_2m_min'][0]:.0f}~{daily['temperature_2m_max'][0]:.0f}°C{rain}"
    except Exception:
        return ""


def countdown_line():
    parts, today = [], date.today()
    for item in load_cfg().get("countdowns", []):
        label, target = str(item.get("label", "")).strip(), str(item.get("date", "")).strip()
        try:
            diff = (date.fromisoformat(target) - today).days
        except ValueError:
            continue
        if diff > 0:
            parts.append(f"⏳ 距{label}还有 {diff} 天")
        elif diff == 0:
            parts.append(f"🎯 今天就是{label}，加油！")
    return " ｜ ".join(parts)


def budget_line(data, today_iso):
    budget = float(load_cfg().get("monthly_budget", 0))
    if budget <= 0:
        return ""
    spent = month_expense(data, today_iso)
    pct = spent / budget * 100
    icon = "🔴" if pct >= 100 else ("🟡" if pct >= 80 else "🟢")
    warn = "，已超支！管住手！💸" if pct >= 100 else ("，快到预算上限了注意点～" if pct >= 80 else "")
    return f"{icon} 本月消费 ¥{spent:g}/预算¥{budget:g}（{pct:.0f}%）{warn}"


def weight_alert(data, today_iso):
    pts = weight_points(data, today_iso)
    if len(pts) >= 3 and pts[-1][1] > pts[-2][1] > pts[-3][1]:
        a, b, c = (f"{w:g}" for _, w in pts[-3:])
        return f"⚠️ 体重连涨3天啦（{a}→{b}→{c}kg），今晚跑步5km安排上！"
    return ""


# ---------- 命令 ----------

def cmd_today(_=None):
    data, today = load(), date.today()
    print(f"📋 {today} 周{WEEKDAY[today.weekday()]} · 今日任务（{len(tasks_of(data, today))} 项）")
    w, cd = get_weather(), countdown_line()
    if w:
        print(f"🌤 {CITY}：{w}")
    if cd:
        print(cd)
    ts = tasks_of(data, today)
    if not ts:
        print("今天还没有安排，休息或加几个任务吧～")
    else:
        print("\n".join(fmt_list(ts)))
        print(f"进度：{sum(1 for t in ts if t.get('done'))}/{len(ts)}")
    yst = today - timedelta(days=1)
    yts = tasks_of(data, yst)
    lines = [f"\n📖 昨日（{str(yst)[5:]}）：完成 {sum(1 for t in yts if t.get('done'))}/{len(yts)} 项"]
    lines += day_summary(data, yst)[0]
    print("\n".join(lines))


def cmd_pending(_=None):
    data, today = load(), date.today()
    undone = [t for t in tasks_of(data, today) if not t.get("done")]
    rec = data.get("dailyRecords", {}).get(iso(today), {})
    parts = [f"🌙 今日收尾 · {today}"]
    if undone:
        parts += [f"\n未完成 {len(undone)} 项："] + fmt_list(undone)
    else:
        parts.append("今日任务全部完成 🎉 太棒了！")
    parts.append("")
    parts += day_summary(data, today)[0]
    for extra in (budget_line(data, iso(today)), weight_alert(data, iso(today))):
        if extra:
            parts.append(extra)
    parts.append("\n✍️ 还没写今日复盘哦（心情/亮点/明日计划），去 App 记一下～"
                 if not has_review(rec) else "今日复盘已写 ✔")
    print("\n".join(parts))


def _duration_hours(t):
    try:
        return float(str(t.get("duration", "")).strip())
    except ValueError:
        return 0.0  # 时长按分钟记录，展示时转小时


def cmd_weekly(_=None):
    data, today = load(), date.today()
    monday = today - timedelta(days=today.weekday())
    days = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
    ts = [t for t in data.get("tasks", []) if t.get("date") in days]
    done_ts = [t for t in ts if t.get("done")]
    parts = [f"📊 本周成长周报（{days[0][5:]} ~ {days[-1][5:]}）", ""]
    if not ts:
        parts.append("本周还没有任务记录")
    else:
        parts.append(f"✅ 任务完成率 {len(done_ts) / len(ts) * 100:.0f}%（{len(done_ts)}/{len(ts)}）")
        bycat = {}
        for t in ts:
            n, dcnt, mins = bycat.get(t.get("category", "其他"), (0, 0, 0.0))
            bycat[t.get("category", "其他")] = (n + 1, dcnt + bool(t.get("done")), mins + _duration_hours(t))
        for c, (n, dcnt, mins) in sorted(bycat.items()):
            parts.append(f"  {CAT_EMOJI.get(c, '📌')} {c}：{dcnt}/{n}" + (f" · {mins / 60:.1f}h" if mins else ""))
    exp = inc = reviews = 0
    weights = {}
    for d in days:
        r = data.get("dailyRecords", {}).get(d, {})
        e, i, _ = money_of(r)
        exp, inc = exp + e, inc + i
        reviews += has_review(r)
        wt = str(r.get("weight", "")).strip()
        if wt:
            weights[d] = float(wt)
    parts.append(f"💰 本周支出 ¥{exp:g} · 收入 ¥{inc:g}")
    parts.append(f"📝 复盘 {reviews}/7 天")
    if weights:
        first, last = sorted(weights.items())[0], sorted(weights.items())[-1]
        parts.append(f"⚖️ 体重 {first[1]:g}→{last[1]:g}kg（{last[1] - first[1]:+.1f}）")
    tip = ai_comment(ts, len(done_ts), exp, inc, reviews, weights)
    if tip:
        parts += ["", f"🤖 AI 点评：{tip}"]
    print("\n".join(parts))


def ai_comment(ts, done_count, exp, inc, reviews, weights):
    cfg = load_cfg()
    if not cfg.get("deepseek_api_key"):
        return ""
    cats = {}
    for t in ts:
        c = cats.setdefault(t.get("category", "其他"), {"共": 0, "完成": 0})
        c["共"] += 1
        c["完成"] += bool(t.get("done"))
    brief = {"任务总数": len(ts), "完成数": done_count, "分类": cats,
             "周支出": round(exp, 1), "周收入": round(inc, 1), "复盘天数": reviews,
             "体重变化": dict(sorted(weights.items())) or None}
    body = json.dumps({
        "model": cfg.get("deepseek_model", "deepseek-chat"),
        "messages": [
            {"role": "system", "content": "你是个人成长教练。根据用户一周的任务、消费、体重、复盘数据，"
                                          "给出不超过60字的中文点评：先肯定亮点，再给一条最关键的建议。"
                                          "语气亲切，不要客套。只输出点评正文。"},
            {"role": "user", "content": json.dumps(brief, ensure_ascii=False)},
        ],
        "max_tokens": 150,
    }, ensure_ascii=False).encode()
    try:
        req = urllib.request.Request(
            cfg.get("deepseek_api_url", "https://api.deepseek.com/chat/completions"),
            data=body, headers={"Content-Type": "application/json",
                                "Authorization": f"Bearer {cfg['deepseek_api_key']}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


def cmd_day(args):
    data, day = load(), args.date or date.today().isoformat()
    wd = weekday_cn(day) if len(str(day)) == 10 else ""
    print(f"📅 {day} {'周' + wd if wd else ''}")
    ts = tasks_of(data, day)
    print("\n".join(fmt_list(ts)) if ts else "（无任务）")
    summary, rec = day_summary(data, day)
    if summary:
        print("\n" + "\n".join(summary))
    if has_review(rec):
        s = rec.get("reviewSummary") or rec.get("reviewHighlights")
        print(f"\n📝 复盘：{s[:60]}")


def cmd_gen(_=None):
    """把周期任务模板生成为今天的任务（同日同名已存在则跳过）"""
    data, today = load(), date.today()
    existing = {str(t.get("title", "")) for t in tasks_of(data, today)}
    templates = [x for x in load_cfg().get("recurring", []) if x.get("title")]
    made = 0
    for tpl in templates:
        if str(tpl["title"]) in existing:
            continue
        data["tasks"].append(new_task(
            str(tpl["title"]), today, time_=tpl.get("time") or "", category=tpl.get("category"),
            priority=tpl.get("priority"), subcategory=tpl.get("subcategory"),
            type=tpl.get("type") or tpl.get("subcategory"), sport_type=tpl.get("sport_type") or tpl.get("subcategory"),
            duration=tpl.get("duration"), distance=tpl.get("distance"), count=tpl.get("count"),
            subject=tpl.get("subject")))
        made += 1
    if made:
        save(data)
    skipped = len(templates) - made
    print(f"🔁 周期任务：今日新增 {made} 条" + ("（其余已存在）" if skipped else ""))


def cmd_add(args):
    data, day = load(), args.date or date.today().isoformat()
    task = new_task(args.title, day, args.time, args.category, args.priority)
    data["tasks"].append(task)
    save(data)
    print(f"✅ 已添加任务「{args.title}」→ {day}{f' {args.time}' if args.time else ''}（{task['category']}）")


def cmd_done(args):
    data, day = load(), args.date or date.today().isoformat()
    hits = [t for t in match_tasks(data, args.keyword, day) if not t.get("done")]
    if not hits:
        done_before = any(t.get("done") for t in match_tasks(data, args.keyword, day))
        print("没找到未完成的匹配任务" + ("（可能已完成）" if done_before else ""))
        return
    for t in hits:
        t["done"] = True
    save(data)
    print("\n".join(f"✅ 已完成：{t['title']}（{day}）" for t in hits))


def cmd_del(args):
    data, day = load(), args.date or date.today().isoformat()
    hits = match_tasks(data, args.keyword, day)
    if not hits:
        print("没找到匹配的任务")
        return
    data["tasks"] = [t for t in data["tasks"] if t not in hits]
    save(data)
    print("\n".join(f"🗑 已删除：{t['title']}（{day}）" for t in hits))


def cmd_rec(args):
    data, day = load(), args.date or date.today().isoformat()
    rec = data.setdefault("dailyRecords", {}).setdefault(day, {})
    kind, value, note = args.kind, args.value, args.note or ""
    if kind in MEAL_KEYS:
        rec[MEAL_KEYS[kind]] = value
        print(f"✅ {day} {MEAL_KEYS[kind]}已记录：{value}")
    elif kind in ("体重", "称重"):
        try:
            float(value)
        except ValueError:
            sys.exit("体重需要是数字，例如：rec 体重 65.5")
        rec["weight"] = str(value)
        print(f"✅ {day} 体重已记录：{value}kg")
    elif kind in ("支出", "消费", "花"):
        rec.setdefault("expenseItems", []).append({"amount": float(value), "note": note})
        total = sum(i["amount"] for i in rec["expenseItems"])
        print(f"✅ {day} 支出 ¥{value}（{note or '未备注'}），当日共 ¥{total:g}")
    elif kind == "收入":
        rec.setdefault("incomeItems", []).append({"amount": float(value), "note": note})
        total = sum(i["amount"] for i in rec["incomeItems"])
        print(f"✅ {day} 收入 ¥{value}（{note or '未备注'}），当日共 ¥{total:g}")
    else:
        sys.exit(f"不支持的类型：{kind}（可用：早餐/午餐/晚餐/体重/支出/收入）")
    save(data)


# ---------- 入口 ----------

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("today", "pending", "weekly", "gen"):
        sub.add_parser(name)
    x = sub.add_parser("day")
    x.add_argument("--date", default="")
    x = sub.add_parser("add")
    x.add_argument("title")
    for flag in ("--date", "--time"):
        x.add_argument(flag, default="")
    x.add_argument("--category", default="其他")
    x.add_argument("--priority", default="normal")
    for name, help_ in (("done", "完成任务"), ("del", "删除任务")):
        x = sub.add_parser(name)
        x.add_argument("keyword", help=help_)
        x.add_argument("--date", default="")
    x = sub.add_parser("rec")
    x.add_argument("kind", help="早餐/午餐/晚餐/体重/支出/收入")
    x.add_argument("value")
    x.add_argument("note", nargs="?", default="")
    x.add_argument("--date", default="")
    args = p.parse_args()
    {"today": cmd_today, "pending": cmd_pending, "weekly": cmd_weekly, "gen": cmd_gen,
     "day": cmd_day, "add": cmd_add, "done": cmd_done, "del": cmd_del, "rec": cmd_rec}[args.cmd](args)
