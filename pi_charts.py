# -*- coding: utf-8 -*-
"""生成趋势图：体重曲线 + 近30天消费柱状图 → charts/report.png"""
import sys, json, io
from datetime import date, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BASE = Path(__file__).resolve().parent
DATA = BASE / "data.json"
OUT = BASE / "charts" / "report.png"

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    recs = data.get("dailyRecords", {})
    today = date.today()
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    labels = [d[5:] for d in days]

    weights = [float(recs[d]["weight"]) if str(recs.get(d, {}).get("weight", "")).strip() else None for d in days]
    w_days = [(labels[i], weights[i]) for i in range(len(days)) if weights[i]]
    expenses = []
    for d in days:
        r = recs.get(d, {})
        items = r.get("expenseItems") or ([{"amount": float(r["expense"])}] if str(r.get("expense", "")).strip() else [])
        expenses.append(sum(float(i["amount"]) for i in items))

    fig, axes = plt.subplots(2, 1, figsize=(9, 7))
    ax = axes[0]
    if len(w_days) >= 2:
        xs, ys = zip(*w_days)
        ax.plot(xs, ys, marker="o", color="#e67e22", linewidth=2)
        for x, y in list(zip(xs, ys))[-3:]:
            ax.annotate(f"{y:g}", (x, y), textcoords="offset points", xytext=(0, 8), ha="center", fontsize=9)
        diff = ys[-1] - ys[0]
        ax.set_title(f"体重曲线（近30天，{diff:+.1f}kg）")
        ax.grid(alpha=0.3)
        plt.setp(ax.get_xticklabels(), rotation=45, fontsize=7)
    else:
        ax.text(0.5, 0.5, "近30天体重记录太少\n（至少2天）才能画曲线哦", ha="center", va="center", fontsize=13)
        ax.set_axis_off()

    ax = axes[1]
    colors = ["#e74c3c" if v > 30 else ("#f39c12" if v > 0 else "#95a5a6") for v in expenses]
    ax.bar(labels, expenses, color=colors)
    total = sum(expenses)
    ax.set_title(f"每日消费（近30天合计 ¥{total:g}）")
    ax.grid(axis="y", alpha=0.3)
    plt.setp(ax.get_xticklabels(), rotation=45, fontsize=7)

    fig.suptitle(f"每日清单 · 趋势报告 {today}", fontsize=14, y=0.99)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    OUT.parent.mkdir(exist_ok=True)
    fig.savefig(OUT, dpi=110)
    print(f"✅ 图表已生成：{OUT}")


if __name__ == "__main__":
    main()
