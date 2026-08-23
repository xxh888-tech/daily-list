const state = { tasks: [], dailyRecords: {}, goals: [], habits: [], statsData: null, growthReport: null, growthReports: {}, selectedDate: formatDate(new Date()), filter: 'all', query: '', editingId: null, editingGoalId: null, category: 'all', generatedReview: null, view: 'today', statsCategory: null, statsType: null, statsTrendMode: 'week', english: null, engTab: 'plan', engWordQuery: '', engSessionId: null, engMessages: [], engQuiz: null };
const AI_REVIEW_ENDPOINT = '/api/ai/review';
const categories = ['工作', '生活', '学习', '健康', '其他'];
const subcategories = { 工作:['项目开发','日常工作','其他','未分类'], 生活:['家务','饮食','阅读','其他','未分类'], 学习:['教资科目一','教资科目二','教资科目三','英语单词','英语听力','编程学习','AI学习','其他','未分类'], 健康:['跑步','跳绳','篮球','健身','力量训练','其他','未分类'], 其他:['未分类','其他'] };
const encouragements = ['慢慢来，也是在向前走。', '完成比完美更重要。', '把今天过好，就是最好的答案。', '专注当下，事情会一点点变好。', '你已经比昨天更靠近目标了。', '先做起来，答案会在路上出现。', '给自己一点耐心，好事正在发生。'];
const colors = { 工作: '#8174de', 生活: '#e6a14e', 学习: '#55b68e', 健康: '#e27c80', 减肥: '#8aa66a', 其他: '#8d96a9' };
const $ = (id) => document.getElementById(id);

function formatDate(date) { return new Intl.DateTimeFormat('en-CA').format(date); }
function dateObj(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
function isToday(value) { return value === formatDate(new Date()); }
function dateText(value, long = false) {
  if (isToday(value)) return '今天';
  const d = dateObj(value); return long ? `${d.getMonth()+1}月${d.getDate()}日` : `${d.getMonth()+1}月${d.getDate()}日`;
}
function weekday(value) { return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][dateObj(value).getDay()]; }
function escapeHtml(s='') { return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function encouragement(task) { const key = `${task.id || ''}${task.title || ''}`; let total = 0; for (const char of key) total = (total + char.charCodeAt(0)) % encouragements.length; return encouragements[total]; }
function weekDates(anchor) { const date = dateObj(anchor); const day = date.getDay(); date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day)); return Array.from({length:7}, (_, index) => { const item = new Date(date); item.setDate(date.getDate() + index); return formatDate(item); }); }
function taskStatsFor(date) { const tasks = state.tasks.filter(task => task.date === date); return {tasks, total:tasks.length, done:tasks.filter(task => task.done).length}; }
function parseDuration(task) {
  const metrics = taskMetrics(task);
  const measured = metrics.durationMinutes || metrics.projectTimeMinutes;
  if (measured > 0) return measured;
  const explicit = Number(task.duration);
  if (Number.isFinite(explicit) && explicit > 0) return explicit < 10 ? explicit * 60 : explicit;
  const text = `${task.title || ''} ${task.note || ''}`;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(小时|小時|hour(?:s)?|h|分钟|分鐘|minute(?:s)?|min|分|m)/i);
  if (match) { const amount = Number(match[1]); return /小时|小時|hour|^h$/i.test(match[2]) ? amount * 60 : amount; }
  return task.done ? 30 : 0;
}
function formatMinutes(minutes) { return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}小时` : `${minutes}分钟`; }
function isLearningDay(date) { return state.tasks.some(task => task.date === date && task.done && task.category === '学习'); }
function learningStreak(anchor) { let count = 0; const date = dateObj(anchor); while (isLearningDay(formatDate(date))) { count += 1; date.setDate(date.getDate() - 1); } return count; }
function moodLabel(mood) { return {happy:'开心',calm:'平静',okay:'一般',tired:'疲惫',sad:'低落'}[mood] || ''; }
function recentDateLabel(value) { if (!value) return '暂无记录'; const date = dateObj(value); return isToday(value) ? '今天' : `${date.getMonth()+1}月${date.getDate()}日`; }
const goalCategories = ['健康','学习','工作','生活','减肥'];
const goalMetricConfig = {
  健康: [{value:'distance', label:'运动距离', unit:'公里'}, {value:'duration', label:'运动时间', unit:'小时'}, {value:'completedCount', label:'完成次数', unit:'次'}],
  学习: [{value:'duration', label:'学习时间', unit:'小时'}, {value:'completedCount', label:'学习次数', unit:'次'}],
  工作: [{value:'completedCount', label:'完成任务', unit:'个'}, {value:'duration', label:'投入时间', unit:'小时'}],
  生活: [{value:'completedCount', label:'完成任务', unit:'个'}, {value:'duration', label:'投入时间', unit:'小时'}],
  减肥: [{value:'weight', label:'目标体重', unit:'kg'}]
};
function defaultGoalMetric(category) { return category === '健康' ? 'distance' : category === '学习' ? 'duration' : category === '减肥' ? 'weight' : 'completedCount'; }
function goalMetricInfo(goal = {}) { const category = goal.category || '学习'; const options = goalMetricConfig[category] || goalMetricConfig.生活; return options.find(item => item.value === (goal.metric || defaultGoalMetric(category))) || options[0]; }
function goalSportType(goal = {}) { const name = `${goal.name || ''}${goal.title || ''}`; if (/跑步|慢跑|长跑/.test(name)) return '跑步'; if (/跳绳/.test(name)) return '跳绳'; if (/篮球/.test(name)) return '篮球'; if (/健身|力量训练|举铁/.test(name)) return '健身'; return ''; }
function normalizeGoal(goal = {}) { const category = goalCategories.includes(goal.category) ? goal.category : '学习'; const targetValue = Number(goal.targetValue ?? goal.target ?? goal.value); return {...goal, name:String(goal.name || goal.title || '未命名目标'), category, period:['week','month','year'].includes(goal.period) ? goal.period : 'month', metric:goalMetricInfo({...goal, category}).value, targetValue:Number.isFinite(targetValue) && targetValue > 0 ? targetValue : 1}; }
function goalRange(period, anchor = state.selectedDate) { const date = dateObj(anchor); if (period === 'week') { const start = new Date(date); start.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1)); const end = new Date(start); end.setDate(start.getDate() + 6); return {start:formatDate(start), end:formatDate(end)}; } if (period === 'year') return {start:formatDate(new Date(date.getFullYear(), 0, 1)), end:formatDate(new Date(date.getFullYear(), 11, 31))}; return {start:formatDate(new Date(date.getFullYear(), date.getMonth(), 1)), end:formatDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))}; }
function goalPeriodLabel(period) { return period === 'week' ? '周目标' : period === 'year' ? '年目标' : '月目标'; }
function goalValue(value, metric) { if (value == null || value === '') return '暂无'; const number = Number(value) || 0; return metric === 'completedCount' ? String(Math.round(number)) : number.toFixed(number % 1 ? 1 : 0); }
function recordWeight(record = {}) { const value = Number(record.weight ?? record.weightKg ?? record.bodyWeight); return Number.isFinite(value) && value > 0 ? value : 0; }
function weightEntries() { return Object.entries(state.dailyRecords).map(([date, record]) => [date, recordWeight(record)]).filter(([date, weight]) => date <= state.selectedDate && weight > 0).sort((a,b) => a[0].localeCompare(b[0])); }
function latestWeightValue() { const entries = weightEntries(); return entries.length ? entries[entries.length - 1][1] : 0; }
function currentWeight() { const entries = weightEntries(); return entries.length ? entries[entries.length - 1][1] : 0; }
function startWeight(goal) { const item = normalizeGoal(goal); if (Number(item.startWeight) > 0) return Number(item.startWeight); const all = weightEntries(); const created = String(item.createdAt || '').slice(0, 10); const pool = /^\d{4}-\d{2}-\d{2}$/.test(created) ? all.filter(([date]) => date >= created) : []; const entries = pool.length ? pool : all; return entries.length ? entries[0][1] : 0; }
function goalCurrentValue(goal) { const item = normalizeGoal(goal); if (item.category === '减肥') return currentWeight(); const range = goalRange(item.period); const sport = item.category === '健康' ? goalSportType(item) : ''; const tasks = state.tasks.filter(task => task.done && task.category === item.category && (!sport || taskType(task) === sport) && task.date >= range.start && task.date <= state.selectedDate); if (item.metric === 'distance') return tasks.reduce((sum, task) => sum + taskMetrics(task).distanceKm, 0); if (item.metric === 'completedCount' && sport) return tasks.reduce((sum, task) => sum + (taskMetrics(task).count || (sport === '跳绳' ? 0 : 1)), 0); if (item.metric === 'duration') return tasks.reduce((sum, task) => { const metrics = taskMetrics(task); const minutes = item.category === '工作' ? (metrics.projectTimeMinutes || parseDuration(task)) : parseDuration(task); return sum + minutes / 60; }, 0); return tasks.length; }
function goalProgress(goal) { const item = normalizeGoal(goal); const info = goalMetricInfo(item); const current = goalCurrentValue(item); const range = goalRange(item.period); if (item.category === '减肥') { const initial = startWeight(item); const totalLoss = initial - item.targetValue; const lost = initial - current; return {...item, info, current, initial, lost, totalLoss, percent:totalLoss > 0 ? Math.min(100, Math.max(0, Math.round(lost / totalLoss * 100))) : current > 0 && current <= item.targetValue ? 100 : 0, remaining:current ? Math.max(current - item.targetValue, 0) : null, deadline:range.end}; } const percent = Math.min(100, Math.round(current / item.targetValue * 100)); return {...item, info, current, percent, remaining:Math.max(item.targetValue - current, 0), deadline:range.end}; }
function goalDisplayValue(goal, value) { return goal.category === '减肥' && !Number(value) ? '暂无' : goalValue(value, goal.metric); }
function weightGoalSummary(goal) { const initial = Number(goal.initial) || 0; const current = Number(goal.current) || 0; const lost = initial > 0 && current > 0 ? Math.max(initial - current, 0) : 0; return `初始 ${initial > 0 ? goalValue(initial, 'weight') : '暂无'}kg · 当前 ${current > 0 ? goalValue(current, 'weight') : '暂无'}kg / 目标 ${goalValue(goal.targetValue, 'weight')}kg · 已减 ${lost.toFixed(1)}kg`; }
function renderGoalMetricOptions(selected = '') { const category = $('goalCategory').value; const options = goalMetricConfig[category] || goalMetricConfig.生活; $('goalMetric').innerHTML = options.map(item => `<option value="${item.value}">${item.label}（${item.unit}）</option>`).join(''); const value = options.some(item => item.value === selected) ? selected : defaultGoalMetric(category); $('goalMetric').value = value; const info = options.find(item => item.value === value) || options[0]; $('goalUnit').textContent = info.unit; $('goalTargetLabel').textContent = category === '减肥' ? '目标体重' : '目标数值'; $('goalTarget').placeholder = category === '减肥' ? '例如：60' : '例如：100'; $('goalStartWeightRow').classList.toggle('hidden', category !== '减肥'); if (category === '减肥' && !$('goalStartWeight').value) { const weight = latestWeightValue(); if (weight > 0) $('goalStartWeight').value = weight; } }
function renderGoals() { const list = $('goalsList'); if (!list) return; const goals = state.goals.filter(Boolean).map(goalProgress); $('goalsEmpty').classList.toggle('hidden', goals.length > 0); list.innerHTML = goals.map(goal => `<article class="goal-card"><div class="goal-card-header"><div><h3>${escapeHtml(goal.name)}</h3><div class="goal-tags"><span class="tag ${escapeHtml(goal.category)}">${escapeHtml(goal.category)}</span><span class="goal-period">${goalPeriodLabel(goal.period)}</span><span class="goal-metric-label">${escapeHtml(goal.info.label)}</span></div></div><div class="goal-actions"><button type="button" data-goal-action="edit" data-id="${escapeHtml(goal.id || '')}" aria-label="编辑目标">✎</button><button type="button" data-goal-action="delete" data-id="${escapeHtml(goal.id || '')}" aria-label="删除目标">×</button></div></div><div class="goal-progress-copy"><strong>${goal.category === '减肥' ? weightGoalSummary(goal) : `当前进度 ${goalDisplayValue(goal, goal.current)} ${goal.info.unit} / 目标值 ${goalValue(goal.targetValue, goal.metric)} ${goal.info.unit}`}</strong><b>${goal.percent}%</b></div><div class="goal-progress-track"><i style="width:${goal.percent}%;background:${colors[goal.category] || colors.其他}"></i></div><div class="goal-card-meta"><span>剩余 ${goal.remaining == null ? '暂无' : `${goalValue(goal.remaining, goal.metric)} ${goal.info.unit}`}</span><span>截止 ${recentDateLabel(goal.deadline)}</span></div></article>`).join(''); }
function openGoalModal(goal = null) { state.editingGoalId = goal?.id || null; const item = normalizeGoal(goal || {category:'健康', period:'week', metric:'distance'}); $('goalModalTitle').textContent = goal ? '编辑目标' : '新建目标'; $('goalName').value = goal ? item.name : ''; $('goalCategory').value = item.category; $('goalPeriod').value = item.period; $('goalStartWeight').value = goal && item.startWeight ? item.startWeight : ''; renderGoalMetricOptions(item.metric); $('goalTarget').value = goal ? item.targetValue : ''; if (!goal && item.category === '减肥') { const weight = latestWeightValue(); $('goalStartWeight').value = weight > 0 ? weight : ''; } $('goalModalBackdrop').classList.remove('hidden'); setTimeout(() => $('goalName').focus(), 50); }
function closeGoalModal() { $('goalModalBackdrop').classList.add('hidden'); state.editingGoalId = null; }
function inferGoalPayload() { const metric = goalMetricInfo({category:$('goalCategory').value, metric:$('goalMetric').value}); return {name:$('goalName').value.trim(), category:$('goalCategory').value, period:$('goalPeriod').value, metric:$('goalMetric').value, targetValue:Number($('goalTarget').value), startWeight:$('goalCategory').value === '减肥' && $('goalStartWeight').value !== '' ? Number($('goalStartWeight').value) : '', unit:metric.unit}; }
function inferSportType(task) { const text = `${task.title || ''} ${task.note || ''}`; if (/跑步|慢跑|长跑/.test(text)) return '跑步'; if (/跳绳/.test(text)) return '跳绳'; if (/篮球/.test(text)) return '篮球'; if (/健身|力量训练|举铁/.test(text)) return '健身'; return ''; }
function inferLearningSubject(task) { const text = `${task.title || ''} ${task.note || ''}`; const matches = [['教资科目一',/教资?\s*科目一|科目一/],['教资科目二',/教资?\s*科目二|科目二/],['教资科目三',/教资?\s*科目三|科目三/],['英语单词',/英语单词|背单词|单词/],['英语听力',/英语听力|听力/],['编程学习',/编程|代码|开发/],['AI学习',/AI学习|人工智能|机器学习/]]; return matches.find(([, pattern]) => pattern.test(text))?.[0] || ''; }
function taskType(task) { if (task.category === '工作') return task.project || '未分类'; const value = task.category === '健康' ? (task.sport_type || task.type || inferSportType(task)) : task.category === '学习' ? (task.subject || task.type || inferLearningSubject(task)) : task.type; return value || task.subcategory || '未分类'; }
function workType(task) { return task.category === '工作' ? (task.work_type || task.type || task.subcategory || '未分类') : ''; }
function subcategoryFor(task) { return taskType(task); }
function taskMetrics(task = {}) { const raw = task.metrics && typeof task.metrics === 'object' ? task.metrics : {}; const aliases = {durationMinutes:['durationMinutes','duration','studyDurationMinutes','studyDuration'], distanceKm:['distanceKm','distance'], count:['count','repetitions'], projectTimeMinutes:['projectTimeMinutes','projectMinutes']}; const value = key => { for (const name of aliases[key]) { const number = Number(raw[name] ?? task[name]); if (Number.isFinite(number) && number > 0) return number; } return 0; }; const result = {durationMinutes:value('durationMinutes'), distanceKm:value('distanceKm'), count:value('count'), projectTimeMinutes:value('projectTimeMinutes')}; if (!result.distanceKm) { const match = `${task.title || ''} ${task.note || ''}`.match(/(\d+(?:\.\d+)?)\s*(公里|千米|km|kilometers?)/i); if (match) result.distanceKm = Number(match[1]); } if (!result.count && task.category === '健康' && inferSportType(task) === '跳绳') { const match = `${task.title || ''} ${task.note || ''}`.match(/(?:跳绳\s*(\d+(?:\.\d+)?)|(?<!跳绳\s)(\d+(?:\.\d+)?)\s*(?:次|个|下))/); if (match) result.count = Number(match[1] || match[2]); } return result; }
function metricField(id, label, placeholder, step = '1') { const keys = {metricDuration:'durationMinutes',metricDistance:'distanceKm',metricCount:'count',metricProjectTime:'projectTimeMinutes'}; return `<label class="metric-form-field"><span>${label}</span><div><input id="${id}" data-metric="${keys[id]}" type="number" min="0" step="${step}" placeholder="${placeholder}" /><b>${id === 'metricDistance' ? 'km' : id === 'metricCount' ? '次' : '分钟'}</b></div></label>`; }
function textMetricField(id, label, placeholder) { return `<label class="metric-form-field metric-text-field"><span>${label}</span><div><input id="${id}" type="text" maxlength="60" placeholder="${placeholder}" /></div></label>`; }
function renderTaskMetrics(values = {}, dimensions = {}) { const category = $('taskCategory').value || '其他'; const metrics = taskMetrics({metrics:values}); const fields = category === '学习' ? [textMetricField('metricSubject','学习科目','例如：科目一'), metricField('metricDuration','学习时长','例如 60'), metricField('metricCount','学习次数/数量','例如 1')] : category === '健康' ? [metricField('metricDistance','运动距离','例如 3','0.1'), metricField('metricCount','运动次数','例如 1'), metricField('metricDuration','运动时长','例如 30')] : category === '工作' ? [textMetricField('metricProject','项目名称','例如：每日任务系统'), metricField('metricProjectTime','工作时长','例如 120'), textMetricField('metricAchievement','工作成果','例如：完成AI接口接入')] : [metricField('metricDuration','投入时长','例如 30'), metricField('metricCount','完成数量','例如 1')]; $('taskMetricsFields').innerHTML = `<div class="metrics-form-heading"><span>量化数据</span><small>可选，用于生成分类统计</small></div><div class="metrics-form-grid">${fields.join('')}</div>`; $('metricDuration') && ($('metricDuration').value = metrics.durationMinutes || ''); $('metricDistance') && ($('metricDistance').value = metrics.distanceKm || ''); $('metricCount') && ($('metricCount').value = metrics.count || ''); $('metricProjectTime') && ($('metricProjectTime').value = metrics.projectTimeMinutes || ''); $('metricSubject') && ($('metricSubject').value = dimensions.subject || $('taskSubcategory').value || ''); $('metricProject') && ($('metricProject').value = dimensions.project || ''); $('metricAchievement') && ($('metricAchievement').value = dimensions.achievement || ''); }
function currentTaskMetrics() { const result = {}; document.querySelectorAll('#taskMetricsFields [data-metric]').forEach(input => { if (input.value !== '' && Number(input.value) > 0) result[input.dataset.metric] = Number(input.value); }); return result; }
function currentTaskDimensions() { const metrics = currentTaskMetrics(); return {duration:metrics.durationMinutes || metrics.projectTimeMinutes || '', distance:metrics.distanceKm || '', count:metrics.count || '', subject:$('metricSubject')?.value.trim() || '', project:$('metricProject')?.value.trim() || '', achievement:$('metricAchievement')?.value.trim() || '', work_type:$('taskCategory').value === '工作' ? $('taskSubcategory').value : '', sport_type:$('taskCategory').value === '健康' ? $('taskSubcategory').value : ''}; }
function metricSummary(task) { const metrics = taskMetrics(task), values = []; if (task.category === '健康' && metrics.distanceKm) values.push(`${metrics.distanceKm}km`); if (metrics.count) values.push(`${metrics.count}${task.category === '健康' ? '次' : '项'}`); const minutes = task.category === '工作' ? (metrics.projectTimeMinutes || metrics.durationMinutes) : metrics.durationMinutes; if (minutes) values.push(`${minutes}分钟`); return values.join(' · '); }
function refreshSubcategories(selected = '') { const category = $('taskCategory').value || '其他'; const defaults = subcategories[category] || ['其他']; const options = selected && !defaults.includes(selected) ? [...defaults, selected] : defaults; $('taskSubcategory').innerHTML = options.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join(''); $('taskSubcategory').value = options.includes(selected) ? selected : options[0]; }
function renderTrendChart(stats) {
  const width = 760, height = 218, left = 36, right = 14, top = 16, bottom = 35;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const points = stats.map((item, index) => ({x:left + chartWidth * index / 6, y:top + chartHeight * (1 - item.rate / 100)}));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[6].x},${top + chartHeight} L${points[0].x},${top + chartHeight} Z`;
  const grid = [0,25,50,75,100].map(value => { const y = top + chartHeight * (1 - value / 100); return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" /><text x="${left-9}" y="${y+3}" text-anchor="end">${value}%</text>`; }).join('');
  const labels = points.map((point, index) => `<text x="${point.x}" y="${height-11}" text-anchor="middle">${stats[index].label}</text>`).join('');
  const dots = points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4"/><title>${stats[index].fullLabel}：${stats[index].rate}%</title>`).join('');
  $('trendChart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="过去七天任务完成率趋势"><g class="chart-grid">${grid}</g><path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${dots}<g class="chart-labels">${labels}</g></svg>`;
}
function apiCategoryStats(category) { return state.statsData?.categories?.[category] || null; }
function growthCategoryStats(category, dates) { const endDate = dates.length === 1 ? dates[0] : state.selectedDate; const tasks = state.tasks.filter(task => task.category === category && task.date >= dates[0] && task.date <= endDate); const done = tasks.filter(task => task.done); const durationMinutes = done.reduce((sum, task) => { const metrics = taskMetrics(task); return sum + (category === '工作' ? (metrics.projectTimeMinutes || parseDuration(task)) : parseDuration(task)); }, 0); return {taskCount:tasks.length, completedCount:done.length, durationMinutes:Math.round(durationMinutes * 10) / 10, durationHours:Math.round(durationMinutes / 60 * 10) / 10, distanceKm:Math.round(done.reduce((sum, task) => sum + taskMetrics(task).distanceKm, 0) * 10) / 10, projects:[...new Set(done.map(task => task.category === '工作' ? (task.project || '未分类') : taskType(task)))].slice(0, 10), completedTitles:done.map(task => task.title).slice(0, 12)}; }
function growthReportPayload() { const dates = weekDates(state.selectedDate).filter(date => date <= state.selectedDate); const categoriesData = {}; ['健康','学习','工作'].forEach(category => { categoriesData[category] = growthCategoryStats(category, dates); categoriesData[category].trend = dates.map(date => growthCategoryStats(category, [date])); }); const reviews = dates.map(date => { const record = state.dailyRecords[date] || {}; return {date, mood:record.mood || '', summary:record.reviewSummary || '', highlights:record.reviewHighlights || ''}; }).filter(item => item.mood || item.summary || item.highlights); return {anchor:state.selectedDate, period:{start:dates[0], end:state.selectedDate, label:`${dateObj(dates[0]).getMonth()+1}月${dateObj(dates[0]).getDate()}日—${dateObj(state.selectedDate).getMonth()+1}月${dateObj(state.selectedDate).getDate()}日`}, categories:categoriesData, overall:{taskCount:dates.reduce((sum,date) => sum + state.tasks.filter(task => task.date === date).length, 0), completedCount:dates.reduce((sum,date) => sum + state.tasks.filter(task => task.date === date && task.done).length, 0)}, reviews}; }
function growthText(value) { return Array.isArray(value) ? value.join('；') : String(value || '暂无分析'); }
function growthReportKey(payload) { const period = payload?.period || {}; return `${period.start || ''}:${period.end || payload?.anchor || ''}`; }
function readSavedGrowthReports() { try { const saved = JSON.parse(localStorage.getItem('growthReports') || '{}'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; } catch (error) { return {}; } }
function saveGrowthReports() { try { localStorage.setItem('growthReports', JSON.stringify(state.growthReports)); } catch (error) { console.warn('成长报告本地保存失败', error); } }
function growthReportButtonText() { return state.growthReport ? '↻ 重新生成本周报告' : '✦ AI生成本周报告'; }
function renderGrowthReport() { const card = $('growthReportCard'); if (!card) return; const currentReport = state.growthReports[growthReportKey(growthReportPayload())] || state.growthReport; state.growthReport = currentReport || null; card.classList.toggle('hidden', !state.growthReport); if ($('generateGrowthReportBtn') && !$('generateGrowthReportBtn').disabled) $('generateGrowthReportBtn').textContent = growthReportButtonText(); if (!state.growthReport) return; const report = state.growthReport; $('growthReportPeriod').textContent = report.periodLabel || report.period?.label || `截至 ${dateText(state.selectedDate)} 的最近 7 天`; $('growthReportSource').textContent = report.source === 'ai' ? 'DeepSeek AI' : 'AI报告'; $('growthSummary').textContent = growthText(report.summary); $('growthHealthAnalysis').textContent = growthText(report.healthAnalysis); $('growthLearningAnalysis').textContent = growthText(report.learningAnalysis); $('growthWorkAnalysis').textContent = growthText(report.workAnalysis); const score = typeof report.score === 'object' ? report.score.score : report.score; $('growthScore').textContent = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Math.round(Number(score)))) : '—'; $('growthScoreReason').textContent = typeof report.score === 'object' ? growthText(report.score.reason) : growthText(report.scoreReason); const strengths = Array.isArray(report.strengths) ? report.strengths : []; $('growthStrengths').innerHTML = strengths.length ? strengths.map(item => `<li>${escapeHtml(typeof item === 'string' ? item : item.point || item.text || '')}</li>`).join('') : '<li>暂无记录</li>'; const problems = Array.isArray(report.problems) ? report.problems : []; $('growthProblems').innerHTML = problems.length ? problems.map(item => `<li><strong>${escapeHtml(typeof item === 'string' ? item : item.problem || '')}</strong>${item.cause ? `<span>${escapeHtml(item.cause)}</span>` : ''}</li>`).join('') : '<li>暂无明显问题</li>'; const suggestions = Array.isArray(report.suggestions) ? report.suggestions : Array.isArray(report.improvements) ? report.improvements : []; $('growthSuggestions').innerHTML = suggestions.length ? suggestions.map(item => `<li>${escapeHtml(typeof item === 'string' ? item : item.text || item.suggestion || '')}</li>`).join('') : '<li>暂无建议</li>'; }
function localTrendStats(tasks) { const done = tasks.filter(task => task.done); return {taskCount:tasks.length, completedCount:done.length, durationMinutes:done.reduce((sum, task) => sum + parseDuration(task), 0), distanceKm:done.reduce((sum, task) => sum + taskMetrics(task).distanceKm, 0), projectTimeMinutes:done.reduce((sum, task) => sum + (taskMetrics(task).projectTimeMinutes || (task.category === '工作' ? parseDuration(task) : 0)), 0)}; }
function localCategoryTrend(category, mode) { const anchor = dateObj(state.selectedDate); if (mode === 'week') return weekDates(state.selectedDate).map(date => ({date, ...localTrendStats(state.tasks.filter(task => task.date === date && task.category === category))})); if (mode === 'year' && category === '学习') return Array.from({length:12}, (_, index) => { const start = new Date(anchor.getFullYear(), index, 1); const end = new Date(anchor.getFullYear(), index + 1, 0); const tasks = state.tasks.filter(task => task.category === category && task.date >= formatDate(start) && task.date <= formatDate(end)); return {start:formatDate(start), end:formatDate(end), ...localTrendStats(tasks)}; }); return Array.from({length:4}, (_, index) => { const end = new Date(anchor); end.setDate(anchor.getDate() - (3 - index) * 7); const start = new Date(end); start.setDate(end.getDate() - 6); const tasks = state.tasks.filter(task => task.category === category && task.date >= formatDate(start) && task.date <= formatDate(end)); return {start:formatDate(start), end:formatDate(end), ...localTrendStats(tasks)}; }); }
function localLearningPeriodStats(subject) { const anchor = dateObj(state.selectedDate); const weekStart = new Date(anchor); weekStart.setDate(anchor.getDate() - (anchor.getDay() === 0 ? 6 : anchor.getDay() - 1)); const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const yearStart = new Date(anchor.getFullYear(), 0, 1); const tasks = state.tasks.filter(task => task.category === '学习' && taskType(task) === subject && task.done); const durationBetween = start => tasks.filter(task => task.date >= formatDate(start) && task.date <= state.selectedDate).reduce((sum, task) => sum + parseDuration(task), 0); return {week:durationBetween(weekStart), month:durationBetween(monthStart), year:durationBetween(yearStart)}; }
function localLearningLastDate(subject) { return state.tasks.filter(task => task.category === '学习' && taskType(task) === subject && task.done && task.date <= state.selectedDate).map(task => task.date).sort().pop() || ''; }
function localWorkPeriodStats(project) { const anchor = dateObj(state.selectedDate); const weekStart = new Date(anchor); weekStart.setDate(anchor.getDate() - (anchor.getDay() === 0 ? 6 : anchor.getDay() - 1)); const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const yearStart = new Date(anchor.getFullYear(), 0, 1); const tasks = state.tasks.filter(task => task.category === '工作' && taskType(task) === project && task.done); const duration = task => taskMetrics(task).projectTimeMinutes || parseDuration(task); const durationBetween = start => tasks.filter(task => task.date >= formatDate(start) && task.date <= state.selectedDate).reduce((sum, task) => sum + duration(task), 0); return {week:durationBetween(weekStart), month:durationBetween(monthStart), year:durationBetween(yearStart)}; }
function localWorkLastDate(project) { return state.tasks.filter(task => task.category === '工作' && taskType(task) === project && task.done && task.date <= state.selectedDate).map(task => task.date).sort().pop() || ''; }
function renderDetailTrend(category) {
  const mode = state.statsTrendMode; const apiStats = apiCategoryStats(category); const trendSource = state.statsType && apiStats?.types?.[state.statsType] ? apiStats.types[state.statsType] : apiStats; const apiRecords = category === '学习' || category === '工作' ? null : trendSource ? (mode === 'week' ? trendSource.weeklyTrend : mode === 'month' ? trendSource.monthlyTrend : trendSource.yearlyTrend) : null; const records = Array.isArray(apiRecords) && apiRecords.length ? apiRecords : localCategoryTrend(category, mode);
  const efficiency = category === '生活'; const useWorkTime = category === '工作'; const useDistance = category === '健康' && state.statsType === '跑步'; const useCount = category === '健康' && state.statsType === '跳绳'; const values = records.map(item => efficiency ? (item.taskCount ? Math.round(item.completedCount / item.taskCount * 100) : 0) : useWorkTime ? item.projectTimeMinutes : useDistance ? item.distanceKm : useCount ? item.count : item.durationMinutes); const max = Math.max(...values, 1); const width = 760, height = 190, left = 34, right = 12, top = 18, bottom = 32, chartWidth = width - left - right, chartHeight = height - top - bottom;
  const valueLabel = value => efficiency ? `${value}%` : useWorkTime ? formatMinutes(value) : useDistance ? `${value}km` : useCount ? `${value}次` : formatMinutes(value); const points = values.map((value, index) => ({x:left + chartWidth * (values.length === 1 ? 0.5 : index / (values.length - 1)), y:top + chartHeight * (1 - value / max)})); const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '); const area = `${line} L${points[points.length - 1].x},${top + chartHeight} L${points[0].x},${top + chartHeight} Z`; const labels = records.map((item, index) => { const raw = mode === 'week' ? item.date : item.start; const date = dateObj(raw); return `<text x="${points[index].x}" y="${height - 10}" text-anchor="middle">${date.getMonth()+1}/${date.getDate()}</text>`; }).join(''); const dots = points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${valueLabel(values[index])}</title></circle>`).join(''); const grid = [0,.5,1].map(ratio => { const y = top + chartHeight * ratio; const value = Math.round(max * (1-ratio)); return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text x="${left-8}" y="${y+3}" text-anchor="end">${valueLabel(value)}</text>`; }).join('');
  const title = category === '健康' ? (state.statsType ? `${state.statsType}趋势` : '运动趋势') : category === '学习' ? (mode === 'week' ? '7天学习趋势' : mode === 'month' ? '月度学习趋势' : '年度学习趋势') : category === '工作' ? (mode === 'week' ? '最近7天工作投入趋势' : mode === 'month' ? '月度工作时间趋势' : '年度工作时间趋势') : '生活习惯完成趋势'; const trendMetric = efficiency ? '完成率' : useWorkTime ? '投入时间' : useDistance ? '跑量' : useCount ? '总次数' : '累计时长'; $('detailTrendTitle').textContent = title; $('detailTrendSubtitle').textContent = `${mode === 'week' ? '最近 7 天' : mode === 'month' ? '最近 4 周' : '今年各月'} · ${trendMetric}`; $('detailTrendChart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><g class="chart-grid">${grid}</g><path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${dots}<g class="chart-labels">${labels}</g></svg>`; document.querySelectorAll('[data-trend]').forEach(button => { button.classList.toggle('active', button.dataset.trend === mode); button.onclick = () => { state.statsTrendMode = button.dataset.trend; renderDetailTrend(category); }; });
}
function renderStats() {
  const week = weekDates(state.selectedDate);
  const weekly = week.map(date => { const result = taskStatsFor(date); return {date, total:result.tasks.length, done:result.done, rate:result.tasks.length ? Math.round(result.done / result.tasks.length * 100) : 0, label:`${dateObj(date).getMonth()+1}/${dateObj(date).getDate()}`, fullLabel:`${dateObj(date).getMonth()+1}月${dateObj(date).getDate()}日`}; });
  const today = taskStatsFor(state.selectedDate);
  const weekDone = weekly.reduce((sum, item) => sum + item.done, 0), weekTotal = weekly.reduce((sum, item) => sum + item.total, 0);
  const rate = today.total ? Math.round(today.done / today.total * 100) : 0, weekRate = weekTotal ? Math.round(weekDone / weekTotal * 100) : 0;
  $('statsTodayRate').textContent = `${rate}%`; $('statsTodayDetail').textContent = `${today.done} / ${today.total} 项任务`; $('statsTodayBar').style.width = `${rate}%`;
  $('statsWeekDone').textContent = `${weekDone} / ${weekTotal}`; $('statsWeekDetail').textContent = `完成率 ${weekRate}%`;
  const streak = learningStreak(state.selectedDate); $('statsStreak').innerHTML = `${streak} <b>天</b>`; $('statsStreakDetail').textContent = streak ? `截至 ${dateText(state.selectedDate)} 持续学习中` : '完成学习类任务即可连续';
  const records = week.map(date => state.dailyRecords[date] || {}); const moods = records.filter(record => record.mood); const moodCounts = {};
  moods.forEach(record => moodCounts[record.mood] = (moodCounts[record.mood] || 0) + 1);
  $('statsReviewCount').textContent = `${records.filter(record => record.reviewSummary || record.reviewHighlights || record.reviewChallenges || record.reviewTomorrow || record.mood).length} 天`;
  const moodText = Object.entries(moodCounts).sort((a,b) => b[1] - a[1]).slice(0,2).map(([mood,count]) => `${moodLabel(mood)} ${count}天`).join(' · ');
  $('statsMoodSummary').textContent = moodText || '还没有心情记录'; $('statsMoodDots').innerHTML = Object.keys(moodCounts).map(mood => `<i class="mood-${mood}" title="${moodLabel(mood)}"></i>`).join('');
  $('statsPeriod').textContent = `${dateText(week[0])} — ${dateText(week[6])}`; renderTrendChart(weekly); renderGrowthReport();
  $('weekList').innerHTML = weekly.map(item => `<div class="week-row"><span>${item.label}${item.date === state.selectedDate ? '<b>当前</b>' : ''}</span><span class="week-row-bar"><i style="width:${item.rate}%"></i></span><strong>${item.done}/${item.total}</strong><em>${item.rate}%</em></div>`).join('');
  const timeByCategory = categories.map(category => { const localTasks = state.tasks.filter(task => task.category === category && task.done); const apiStats = apiCategoryStats(category); return {category, minutes:apiStats ? (category === '工作' ? apiStats.projectTimeMinutes : apiStats.durationMinutes) : localTasks.reduce((sum, task) => sum + (category === '工作' ? (taskMetrics(task).projectTimeMinutes || parseDuration(task)) : parseDuration(task)), 0), count:apiStats ? apiStats.completedCount : localTasks.length}; });
  const timeTotal = timeByCategory.reduce((sum, item) => sum + item.minutes, 0), maxTime = Math.max(...timeByCategory.map(item => item.minutes), 1); $('statsTimeTotal').textContent = formatMinutes(timeTotal);
  $('timeChart').innerHTML = timeByCategory.map(item => `<div class="time-row" data-category="${item.category}" role="button" tabindex="0" aria-label="查看${item.category}详情"><span class="time-name"><i style="background:${colors[item.category]}"></i>${item.category}</span><div class="time-bar"><i style="width:${item.minutes / maxTime * 100}%;background:${colors[item.category]}"></i></div><strong>${formatMinutes(item.minutes)}</strong><small>${item.count}项</small></div>`).join('');
  document.querySelectorAll('.time-row[data-category]').forEach(row => { const open = () => { state.statsCategory = row.dataset.category; state.statsType = null; if (row.dataset.category === '学习' || row.dataset.category === '工作') state.statsTrendMode = 'week'; renderStatsDetail(); }; row.onclick = open; row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }; });
  if (state.statsCategory) renderStatsDetail();
}
function renderStatsDetail() {
  const category = state.statsCategory;
  $('statsBackBtn').textContent = state.statsType ? '‹ 返回健康' : '‹ 返回统计'; $('detailTrendCard').classList.toggle('hidden', category === '健康' && !state.statsType);
  $('statsOverview').classList.toggle('hidden', Boolean(category)); $('statsDetail').classList.toggle('hidden', !category);
  if (!category) return;
  const items = state.tasks.filter(task => task.category === category && (!state.statsType || taskType(task) === state.statsType)); const apiStats = apiCategoryStats(category); const groups = {};
  items.forEach(task => {
    const name = subcategoryFor(task); if (!groups[name]) groups[name] = {total:0, done:0, minutes:0, distance:0, count:0, projectMinutes:0, lastDate:'', achievements:[], workType:''}; groups[name].total += 1; if (category === '工作' && !groups[name].workType) groups[name].workType = workType(task);
    if (task.done) { const metrics = taskMetrics(task); const minutes = parseDuration(task); groups[name].done += 1; groups[name].minutes += minutes; groups[name].distance += metrics.distanceKm; groups[name].count += metrics.count || (category === '健康' && name === '跳绳' ? 0 : 1); groups[name].projectMinutes += metrics.projectTimeMinutes || (category === '工作' ? minutes : 0); groups[name].lastDate = !groups[name].lastDate || task.date > groups[name].lastDate ? task.date : groups[name].lastDate; if (category === '工作' && task.achievement) groups[name].achievements.push({date:task.date, text:task.achievement}); }
  });
  const apiTypes = state.statsType && apiStats?.types?.[state.statsType] ? {[state.statsType]:apiStats.types[state.statsType]} : apiStats?.types || null; const details = apiTypes ? Object.entries(apiTypes).map(([name, item]) => [name, {total:item.taskCount, done:item.completedCount, minutes:item.durationMinutes, distance:item.distanceKm, count:item.count, projectMinutes:item.projectTimeMinutes, lastDate:item.lastDate, healthSummary:item.healthSummary, learningSummary:item.learningSummary, workSummary:item.workSummary, workType:item.work_type || '未分类', achievements:[]}]) : Object.entries(groups);
  details.sort((a,b) => category === '工作' ? (b[1].projectMinutes - a[1].projectMinutes || a[0].localeCompare(b[0], 'zh-CN')) : b[1].total - a[1].total || a[0].localeCompare(b[0], 'zh-CN'));
  const totals = details.reduce((sum, [, item]) => ({done:sum.done + item.done, minutes:sum.minutes + item.minutes, distance:sum.distance + item.distance, count:sum.count + item.count, projectMinutes:sum.projectMinutes + item.projectMinutes}), {done:0, minutes:0, distance:0, count:0, projectMinutes:0});
  const healthTarget = category === '健康' && state.statsType && apiStats?.types?.[state.statsType] ? apiStats.types[state.statsType] : null; $('healthCenter').classList.toggle('hidden', !healthTarget); $('detailGenericCards').classList.toggle('hidden', category === '健康' || Boolean(healthTarget)); if (healthTarget) { const period = healthTarget.healthSummary || {}; const today = period.today || {}, week = period.week || {}, month = period.month || {}, year = period.year || {}; const sport = state.statsType || '运动'; const isRun = sport === '跑步', isRope = sport === '跳绳'; const distance = value => `${Number(value.distance || value.distanceKm || 0).toFixed(1)} km`; const count = value => `${Number(value.count ?? value.completedCount ?? 0)} 次`; const duration = value => formatMinutes(Number(value.duration || value.durationMinutes || 0)); const average = year.completedCount ? formatMinutes(Math.round((year.durationMinutes || 0) / year.completedCount)) : '0分钟'; const cards = [[isRope ? '今日跳绳次数' : `今日${sport}`, isRun ? distance(today) : isRope ? `${today.completedCount || 0} 次` : `${today.completedCount || 0} 次`], [isRope ? '最近7天总次数' : `最近7天${sport}`, isRope ? count(week) : duration(week)], [isRun ? '本周跑量' : isRope ? '本周总次数' : '本周完成次数', isRun ? distance(week) : count(week)], [isRun ? '本月跑量' : isRope ? '本月总次数' : '本月完成次数', isRun ? distance(month) : count(month)], [isRun ? '年度累计跑量' : isRope ? '年度累计次数' : '年度累计次数', isRun ? distance(year) : count(year)], ['运动次数', isRope ? `${year.completedCount || 0} 次` : count(year)], ['总运动时间', duration(year)]]; if (!isRun && !isRope) cards.splice(5, 0, ['单次时间', average]); $('healthSummaryCards').innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join(''); }
  if (category === '学习') details.forEach(([name, item]) => { item.learningPeriods = localLearningPeriodStats(name); item.lastDate = localLearningLastDate(name); });
  if (category === '工作') details.forEach(([name, item]) => { item.workPeriods = localWorkPeriodStats(name); item.lastDate = localWorkLastDate(name); item.achievements = items.filter(task => task.done && taskType(task) === name && task.achievement).sort((a,b) => a.date.localeCompare(b.date)).map(task => ({date:task.date, text:task.achievement})); });
  const metricLabel = category === '健康' ? '累计跑量' : category === '学习' ? '学习时长' : category === '工作' ? '总投入时间' : '累计时长'; const metricValue = category === '健康' ? `${totals.distance.toFixed(1)} km` : formatMinutes(category === '工作' ? totals.projectMinutes : totals.minutes);
  const quantityLabel = category === '健康' ? '运动次数' : category === '学习' ? '学习次数' : category === '工作' ? '项目事项数' : '完成数量';
  $('statsDetailTitle').textContent = `${category} · 详细统计`; $('statsDetailSubtitle').textContent = category === '学习' ? `按学习科目查看学习次数、总时长和周期累计 · 共 ${items.length} 项记录` : category === '工作' ? `项目投入排行榜 · 查看完成任务、投入时间和项目成果 · 共 ${items.length} 项任务` : `按类型、科目或项目查看任务次数、完成数量和量化投入 · 共 ${items.length} 项任务`; renderDetailTrend(category);
  $('detailMetricLabel1').textContent = category === '学习' ? '学习次数' : category === '工作' ? '完成任务数量' : '完成任务数'; $('detailMetricValue1').textContent = totals.done; $('detailMetricLabel2').textContent = metricLabel; $('detailMetricValue2').textContent = metricValue; $('detailMetricLabel3').textContent = category === '学习' ? '学习项目数' : category === '工作' ? '项目数量' : quantityLabel; $('detailMetricValue3').textContent = category === '学习' ? details.length : category === '健康' ? `${totals.count} 次` : category === '工作' ? details.length : totals.count;
  const rowMetrics = item => { const sport = category === '健康' ? (details.find(([, value]) => value === item)?.[0] || state.statsType || '') : ''; if (category === '健康') { if (sport === '跑步') return [['跑步次数', item.done], ['累计跑量', `${item.distance.toFixed(1)} km`], ['总运动时间', formatMinutes(item.minutes)]]; if (sport === '跳绳') return [['跳绳任务次数', item.done], ['跳绳总次数', item.count], ['总运动时间', formatMinutes(item.minutes)]]; if (sport === '篮球') return [['篮球次数', item.done], ['单次时间', item.done ? formatMinutes(Math.round(item.minutes / item.done)) : '0分钟'], ['总运动时间', formatMinutes(item.minutes)]]; return [['运动次数', item.done], ['运动距离', `${item.distance.toFixed(1)} km`], ['总运动时间', formatMinutes(item.minutes)]]; } if (category === '学习') { const periods = item.learningPeriods || {week:0, month:0, year:0}; return [['学习次数', item.done], ['总学习时长', formatMinutes(item.minutes)], ['最近学习日期', recentDateLabel(item.lastDate)], ['本周学习时长', formatMinutes(periods.week)], ['本月学习时长', formatMinutes(periods.month)], ['年度累计学习时长', formatMinutes(periods.year)]]; } if (category === '工作') { const periods = item.workPeriods || {week:0, month:0, year:0}; return [['完成任务数量', item.done], ['总投入时间', formatMinutes(item.projectMinutes)], ['最近完成时间', recentDateLabel(item.lastDate)], ['本周投入时间', formatMinutes(periods.week)], ['本月投入时间', formatMinutes(periods.month)], ['年度累计投入时间', formatMinutes(periods.year)]]; } const metrics = [['任务次数', item.total], ['完成数量', item.done], ['累计时长', formatMinutes(item.minutes)], ['数量', item.count]]; return metrics; };
  $('statsDetailList').classList.toggle('health-type-grid', category === '健康'); $('statsDetailList').classList.toggle('learning-detail-list', category === '学习'); $('statsDetailList').classList.toggle('work-detail-list', category === '工作');
  $('statsDetailList').innerHTML = details.length ? details.map(([name, item]) => `<article class="detail-row ${category === '健康' ? 'health-type-card' : ''}" ${category === '健康' ? `data-sport="${escapeHtml(name)}" role="button" tabindex="0"` : ''}><div class="detail-row-title"><i style="background:${colors[category]}"></i><strong>${escapeHtml(name)}</strong>${category === '工作' ? `<small>${escapeHtml(item.workType || '未分类')}</small>` : ''}</div><div class="detail-metric">${rowMetrics(item).map(([label, value]) => `<span>${label}<strong>${value}</strong></span>`).join('')}</div>${category === '工作' && item.achievements?.length ? `<div class="achievement-list"><span>项目成果记录</span>${item.achievements.map(entry => `<p><time>${recentDateLabel(entry.date)}</time>${escapeHtml(entry.text)}</p>`).join('')}</div>` : ''}<div class="detail-progress"><i style="width:${item.total ? item.done / item.total * 100 : 0}%;background:${colors[category]}"></i></div></article>`).join('') : '<div class="detail-empty">这个分类下还没有任务记录。</div>';
  document.querySelectorAll('[data-sport]').forEach(card => { const open = () => { state.statsType = card.dataset.sport; state.statsTrendMode = 'week'; renderStatsDetail(); }; card.onclick = open; card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }; });
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: {'Content-Type':'application/json'}, ...options });
  if (!response.ok) throw new Error((await response.json()).error || '请求失败');
  return response.json();
}
async function refreshStats() { try { state.statsData = await request('/api/stats'); } catch (statsError) { state.statsData = null; console.warn('统计接口暂不可用，使用前端兼容统计', statsError); } }
async function addGoal(payload) { state.goals.push(await request('/api/goals', {method:'POST', body:JSON.stringify(payload)})); render(); }
async function updateGoal(id, payload) { const updated = await request(`/api/goals/${id}`, {method:'PUT', body:JSON.stringify(payload)}); const index = state.goals.findIndex(goal => goal.id === id); if (index >= 0) state.goals[index] = updated; render(); }
async function deleteGoal(id) { await request(`/api/goals/${id}`, {method:'DELETE'}); state.goals = state.goals.filter(goal => goal.id !== id); render(); toast('目标已删除'); }
async function load() {
  try { const data = await request('/api/state'); state.tasks = data.tasks || []; state.dailyRecords = data.dailyRecords || {}; state.goals = Array.isArray(data.goals) ? data.goals : []; state.habits = Array.isArray(data.habits) ? data.habits : []; const serverReports = data.growthReports && typeof data.growthReports === 'object' && !Array.isArray(data.growthReports) ? data.growthReports : {}; state.growthReports = {...readSavedGrowthReports(), ...serverReports}; saveGrowthReports(); state.english = data.english && typeof data.english === 'object' ? data.english : {}; await refreshStats();
  try { const sess = await request('/api/english/sessions'); const latest = (sess.sessions || [])[0];
    if (latest && Array.isArray(latest.messages) && latest.messages.length && !state.engSessionId) {
      state.engSessionId = latest.id;
      state.engMessages = latest.messages.map(m => ({role: m.role === 'user' ? 'user' : 'coach', content: m.content || '', corrections: m.corrections || []}));
      const topicInput = $('engTopic');
      if (topicInput && !topicInput.value && latest.topic && latest.topic !== 'Free talk') topicInput.value = latest.topic;
    } } catch {}
  render(); }
  catch (error) { toast('无法连接到本地服务，请确认 server.py 正在运行'); console.error(error); }
}
async function addTask(payload) { state.tasks.push(await request('/api/tasks', {method:'POST', body:JSON.stringify(payload)})); await refreshStats(); render(); }
async function updateTask(id, payload) { const updated = await request(`/api/tasks/${id}`, {method:'PUT', body:JSON.stringify(payload)}); const i = state.tasks.findIndex(t => t.id === id); if (i >= 0) state.tasks[i] = updated; await refreshStats(); render(); }
async function deleteTask(id) { await request(`/api/tasks/${id}`, {method:'DELETE'}); state.tasks = state.tasks.filter(t => t.id !== id); await refreshStats(); render(); toast('任务已删除'); }

function render() {
  const current = state.selectedDate;
  $('dateText').textContent = dateText(current);
  $('headingDate').textContent = dateText(current);
  $('sidebarDate').textContent = dateText(current);
  $('weekday').textContent = weekday(current);
  $('datePicker').value = current;
  const todayTasks = state.tasks.filter(t => t.date === current);
  const done = todayTasks.filter(t => t.done).length;
  $('doneCount').textContent = done; $('totalCount').textContent = todayTasks.length;
  $('allCount').textContent = todayTasks.length; $('completedCount').textContent = done; $('todoCount').textContent = todayTasks.length - done;
  $('navCount').textContent = state.tasks.filter(t => t.date === formatDate(new Date()) && !t.done).length;
  $('progressPercent').textContent = todayTasks.length ? `${Math.round(done/todayTasks.length*100)}%` : '0%';
  $('progressFill').style.width = todayTasks.length ? `${done/todayTasks.length*100}%` : '0%';
  $('statsDashboard').classList.toggle('hidden', state.view !== 'stats');
  $('goalsDashboard').classList.toggle('hidden', state.view !== 'goals');
  $('englishDashboard').classList.toggle('hidden', state.view !== 'english');
  document.body.classList.toggle('stats-mode', state.view === 'stats');
  document.body.classList.toggle('goals-mode', state.view === 'goals');
  document.body.classList.toggle('english-mode', state.view === 'english');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === state.view));
  renderStats();
  renderGoals();
  renderHabits();
  renderWeightTrend();
  renderCategories();
  renderDailyRecord();
  renderDailyReview();
  if (state.view === 'english') renderEnglish();
  let visible = todayTasks.filter(t => state.category === 'all' || t.category === state.category);
  if (state.filter === 'todo') visible = visible.filter(t => !t.done);
  if (state.filter === 'done') visible = visible.filter(t => t.done);
  if (state.query) visible = visible.filter(t => `${t.title} ${t.note} ${t.category}`.toLowerCase().includes(state.query.toLowerCase()));
  visible.sort((a,b) => Number(a.done)-Number(b.done) || (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '99:99').localeCompare(b.time || '99:99') || ({high:0,normal:1,low:2}[a.priority] - {high:0,normal:1,low:2}[b.priority]));
  $('taskList').innerHTML = visible.map(taskTemplate).join('');
  $('emptyState').classList.toggle('hidden', visible.length > 0);
  if (!visible.length) { $('emptyTitle').textContent = state.query ? '没有找到相关任务' : state.filter === 'done' ? '还没有完成的任务' : '今天还没有任务'; $('emptyText').textContent = state.query ? '试试换一个关键词吧。' : '把想做的事情写下来，让计划从第一步开始。'; }
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('active', el.dataset.filter === state.filter));
}
function renderCategories() {
  const counts = {}; state.tasks.filter(t=>t.date===state.selectedDate).forEach(t=>counts[t.category]=(counts[t.category]||0)+1);
  $('categoryList').innerHTML = `<button class="category-item ${state.category==='all'?'active':''}" data-category="all"><span class="category-dot" style="background:#a5abba"></span><span>全部分类</span><span>${state.tasks.filter(t=>t.date===state.selectedDate).length}</span></button>` + categories.map(c => `<button class="category-item ${state.category===c?'active':''}" data-category="${c}"><span class="category-dot" style="background:${colors[c]}"></span><span>${c}</span><span>${counts[c]||0}</span></button>`).join('');
  document.querySelectorAll('[data-category]').forEach(el => el.addEventListener('click', () => { state.category=el.dataset.category; render(); }));
}
function expenseItemsFor(record = {}) {
  if (Array.isArray(record.expenseItems) && record.expenseItems.length) return record.expenseItems;
  return record.expense !== '' && record.expense != null ? [{amount:record.expense, note:record.expenseNote || ''}] : [];
}
function incomeItemsFor(record = {}) {
  if (Array.isArray(record.incomeItems) && record.incomeItems.length) return record.incomeItems;
  return record.income !== '' && record.income != null ? [{amount:record.income, note:record.incomeNote || ''}] : [];
}
function moneyTotalFor(items) { return items.reduce((sum, item) => sum + (Number(item.amount) > 0 ? Number(item.amount) : 0), 0); }
function expenseTotalFor(record = {}) { return moneyTotalFor(expenseItemsFor(record)); }
function incomeTotalFor(record = {}) { return moneyTotalFor(incomeItemsFor(record)); }
function moneyTotalBetween(match, totalFor) { return Object.entries(state.dailyRecords).reduce((sum, [date, record]) => match(date) ? sum + totalFor(record) : sum, 0); }
function renderExpenseSummary() {
  const month = state.selectedDate.slice(0, 7);
  const year = state.selectedDate.slice(0, 4);
  const monthlyExpense = moneyTotalBetween(date => date.startsWith(month), expenseTotalFor);
  const yearlyExpense = moneyTotalBetween(date => date.startsWith(year), expenseTotalFor);
  const monthlyIncome = moneyTotalBetween(date => date.startsWith(month), incomeTotalFor);
  const yearlyIncome = moneyTotalBetween(date => date.startsWith(year), incomeTotalFor);
  $('monthlyExpenseTotal').textContent = `¥${monthlyExpense.toFixed(2)}`;
  $('yearlyExpenseTotal').textContent = `¥${yearlyExpense.toFixed(2)}`;
  $('monthlyExpenseLabel').textContent = `${Number(month.slice(5))}月累计`;
  $('yearlyExpenseLabel').textContent = `${year}年累计`;
  $('monthlyIncomeTotal').textContent = `¥${monthlyIncome.toFixed(2)}`;
  $('yearlyIncomeTotal').textContent = `¥${yearlyIncome.toFixed(2)}`;
  $('monthlyIncomeLabel').textContent = `${Number(month.slice(5))}月累计`;
  $('yearlyIncomeLabel').textContent = `${year}年累计`;
}
function renderDailyRecord() {
  const record = {special:false, specialLabel:'', breakfast:'', lunch:'', dinner:'', weight:'', expenseItems:[], incomeItems:[], ...(state.dailyRecords[state.selectedDate] || {})};
  const items = expenseItemsFor(record);
  const incomeItems = incomeItemsFor(record);
  renderExpenseSummary();
  $('specialDay').checked = Boolean(record.special);
  $('specialLabel').value = record.specialLabel || '';
  $('breakfast').value = record.breakfast || '';
  $('lunch').value = record.lunch || '';
  $('dinner').value = record.dinner || '';
  $('weight').value = record.weight ?? '';
  $('expenseList').innerHTML = items.map(item => moneyRowTemplate(item, 'expense', '消费内容，例如：午餐、交通')).join('');
  $('expenseEmpty').classList.toggle('hidden', items.length > 0);
  $('incomeList').innerHTML = incomeItems.map(item => moneyRowTemplate(item, 'income', '收入内容，例如：工资、奖金')).join('');
  $('incomeEmpty').classList.toggle('hidden', incomeItems.length > 0);
  updateExpenseTotal();
  updateIncomeTotal();
  const badge = $('specialBadge');
  badge.textContent = record.specialLabel ? `✦ ${record.specialLabel}` : '✦ 特殊日子';
  badge.classList.toggle('hidden', !record.special);
}
function renderDailyReview() {
  const record = state.dailyRecords[state.selectedDate] || {};
  const review = {mood:'', reviewHighlights:'', reviewChallenges:'', reviewGratitude:'', reviewTomorrow:'', reviewSummary:'', ...record};
  document.querySelectorAll('.mood-option').forEach(button => {
    const selected = button.dataset.mood === review.mood;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('reviewHighlights').value = review.reviewHighlights || '';
  $('reviewChallenges').value = review.reviewChallenges || '';
  $('reviewGratitude').value = review.reviewGratitude || '';
  $('reviewTomorrow').value = review.reviewTomorrow || '';
  $('reviewSummary').value = review.reviewSummary || '';
  state.generatedReview = record.generatedReview || null;
  renderGeneratedReview(state.generatedReview);
}
function renderGeneratedReview(review) {
  const output = $('reviewOutput');
  if (!review) { output.innerHTML = ''; output.classList.add('hidden'); return; }
  if (review.raw) { output.innerHTML = `<pre class="review-raw">${escapeHtml(review.raw)}</pre>`; output.classList.remove('hidden'); return; }
  const itemList = (items, fields = []) => (Array.isArray(items) ? items : []).map(item => {
    if (typeof item === 'string') return `<li>${escapeHtml(item)}</li>`;
    const main = escapeHtml(item?.[fields[0]] || item?.point || item?.problem || '');
    const reason = fields[1] && item?.[fields[1]] ? `<span>${escapeHtml(item[fields[1]])}</span>` : '';
    return `<li><strong>${main}</strong>${reason}</li>`;
  }).join('');
  output.innerHTML = `<div class="generated-heading"><span class="eyebrow">COACH'S REVIEW</span><span class="generated-source">${review.source === 'ai' ? 'DeepSeek AI' : '本地生成'}</span></div>
    <section class="generated-section"><h3>今日总结</h3><p>${escapeHtml(review.summary || '暂无总结')}</p></section>
    <section class="generated-section"><h3>今日亮点</h3><ol>${itemList(review.highlights, ['point','reason'])}</ol></section>
    <section class="generated-section"><h3>存在的问题和原因</h3><ol>${itemList(review.problems, ['problem','cause'])}</ol></section>
    <section class="generated-section"><h3>三条可执行的改进建议</h3><ol>${itemList(review.suggestions)}</ol></section>
    <section class="generated-section"><h3>明日最重要的三件事</h3><ol>${itemList(review.tomorrow)}</ol></section>
    <p class="generated-encouragement">${escapeHtml(review.encouragement || '')}</p>`;
  output.classList.remove('hidden');
}
function moneyRowTemplate(item = {}, prefix = 'expense', notePlaceholder = '消费内容') { return `<div class="expense-row ${prefix}-row"><div class="expense-input"><b>¥</b><input class="expense-amount ${prefix}-amount" type="number" min="0" step="0.01" value="${item.amount ?? ''}" placeholder="金额" /></div><input class="record-input expense-note ${prefix}-note" maxlength="80" value="${escapeHtml(item.note || '')}" placeholder="${notePlaceholder}" /><button class="expense-delete ${prefix}-delete" type="button" aria-label="删除${prefix === 'income' ? '收入' : '消费'}记录">×</button></div>`; }
function updateExpenseTotal() { const total = [...document.querySelectorAll('.expense-amount')].filter(input => input.closest('.expense-list')?.id === 'expenseList').reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0); $('expenseTotal').textContent = `¥${total.toFixed(2)}`; }
function updateIncomeTotal() { const total = [...document.querySelectorAll('.income-amount')].reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0); $('incomeTotal').textContent = `¥${total.toFixed(2)}`; }
function addExpenseRow() { $('expenseList').insertAdjacentHTML('beforeend', moneyRowTemplate({}, 'expense', '消费内容，例如：午餐、交通')); $('expenseEmpty').classList.add('hidden'); const inputs = document.querySelectorAll('#expenseList .expense-amount'); inputs[inputs.length - 1]?.focus(); }
function addIncomeRow() { $('incomeList').insertAdjacentHTML('beforeend', moneyRowTemplate({}, 'income', '收入内容，例如：工资、奖金')); $('incomeEmpty').classList.add('hidden'); const inputs = document.querySelectorAll('.income-amount'); inputs[inputs.length - 1]?.focus(); }
function taskTemplate(task) { return `<article class="task-card ${task.done?'completed':''}"><button class="task-check" data-action="toggle" data-id="${task.id}" aria-label="标记完成">✓</button><div class="task-main"><span class="task-title">${escapeHtml(task.title)}</span><span class="task-details">${task.time ? `<span class="task-time">◷ ${escapeHtml(task.time)}</span>` : ''}${metricSummary(task) ? `<span class="task-metric-summary">▣ ${escapeHtml(metricSummary(task))}</span>` : ''}${taskType(task) !== '未分类' ? `<span class="task-subcategory">${escapeHtml(taskType(task))}</span>` : ''}${task.note?`<span class="task-note">${escapeHtml(task.note)}</span>`:''}</span><span class="task-quote">${encouragement(task)}</span></div><div class="task-meta"><span class="priority ${task.priority}" title="${task.priority==='high'?'重要':task.priority==='low'?'不紧急':'普通'}"></span><span class="tag ${escapeHtml(task.category)}">${escapeHtml(task.category)}</span><button class="task-menu" data-action="menu" data-id="${task.id}" aria-label="更多操作">···</button></div></article>`; }

// ===== 每日习惯打卡 =====
function habitTaskFor(habit, date = state.selectedDate) { return state.tasks.find(task => task.habitId === habit.id && task.date === date); }
function habitDayDone(habit, date) { const task = state.tasks.find(item => item.habitId === habit.id && item.date === date && item.done); return Boolean(task); }
function habitStreak(habit) {
  let streak = 0;
  const cursor = dateObj(formatDate(new Date()));
  if (!habitDayDone(habit, formatDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (habitDayDone(habit, formatDate(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}
function renderHabits() {
  const list = $('habitList'); if (!list) return;
  const habits = state.habits.filter(Boolean);
  $('habitEmpty').classList.toggle('hidden', habits.length > 0);
  list.innerHTML = habits.map(habit => {
    const task = habitTaskFor(habit);
    const done = Boolean(task && task.done);
    const streak = habitStreak(habit);
    return `<div class="habit-chip ${done ? 'done' : ''}" data-habit="${escapeHtml(habit.id)}" role="button" tabindex="0" title="${done ? '已打卡，点击取消' : '点击打卡'}"><span class="habit-check">${done ? '✓' : ''}</span><span class="habit-name">${escapeHtml(habit.name)}</span>${streak > 0 ? `<em class="habit-streak">🔥 已坚持${streak}天</em>` : ''}${habit.time ? `<small>◷ ${escapeHtml(habit.time)}</small>` : ''}<button type="button" class="habit-delete" aria-label="删除习惯" title="删除习惯">×</button></div>`;
  }).join('');
}
async function toggleHabitCheckin(habit) {
  const existing = habitTaskFor(habit, state.selectedDate);
  try {
    if (!existing) {
      const payload = {title: habit.name, date: state.selectedDate, time: habit.time || '', category: habit.category || '其他', subcategory: habit.subcategory || '', type: habit.subcategory || '', note: habit.note || '', done: true, habitId: habit.id};
      if (habit.category === '健康') payload.sport_type = habit.subcategory || '';
      if (habit.category === '工作') payload.work_type = habit.subcategory || '';
      if (habit.category === '学习') payload.subject = habit.subcategory || '';
      const task = await request('/api/tasks', {method:'POST', body:JSON.stringify(payload)});
      state.tasks.push(task); await refreshStats(); render();
      toast(`已打卡「${habit.name}」`);
    } else {
      await updateTask(existing.id, {done: !existing.done});
      if (!existing.done) toast(`已打卡「${habit.name}」`);
    }
  } catch (error) { toast(error.message); }
}

// ===== 体重趋势曲线 =====
function renderWeightTrend() {
  const card = $('weightTrendCard'), chart = $('weightTrendChart');
  if (!card || !chart) return;
  const entries = weightEntries().slice(-30);
  const goal = state.goals.filter(Boolean).find(item => item.category === '减肥');
  const target = goal ? Number(goal.targetValue) : 0;
  if (entries.length < 2) { card.classList.add('hidden'); chart.innerHTML = ''; return; }
  card.classList.remove('hidden');
  $('weightTrendTargetLabel').textContent = target ? `目标 ${goalValue(target, 'weight')}kg` : '';
  const current = entries[entries.length - 1][1];
  $('weightTrendSub').textContent = `最近 ${entries.length} 次记录 · 当前 ${current}kg`;
  const w = 760, h = 170, l = 42, r = 16, t = 14, b = 24, cw = w - l - r, ch = h - t - b;
  const values = entries.map(([, v]) => v).concat(target ? [target] : []);
  let min = Math.min(...values), max = Math.max(...values);
  const pad = (max - min) || 1; min -= pad * 0.1; max += pad * 0.14;
  const x = i => l + (entries.length === 1 ? cw / 2 : i / (entries.length - 1) * cw);
  const y = v => t + ch - (v - min) / (max - min) * ch;
  const pts = entries.map(([date, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [0, 0.5, 1].map(ratio => { const gv = max - (max - min) * ratio; const gy = y(gv).toFixed(1); return `<line x1="${l}" y1="${gy}" x2="${w - r}" y2="${gy}" stroke="#ecece6"/><text x="${l - 6}" y="${Number(gy) + 3}" text-anchor="end" font-size="9" fill="#9aa59e">${gv.toFixed(1)}</text>`; }).join('');
  const targetLine = target && target >= min && target <= max ? `<line x1="${l}" y1="${y(target).toFixed(1)}" x2="${w - r}" y2="${y(target).toFixed(1)}" stroke="#e98582" stroke-dasharray="5 4"/><text x="${w - r}" y="${y(target) - 4}" text-anchor="end" font-size="9" fill="#e98582">目标 ${target}kg</text>` : '';
  const dots = entries.map(([date, v], i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === entries.length - 1 ? 3.5 : 2.2}" fill="${i === entries.length - 1 ? '#72a98c' : '#a7cbb5'}"><title>${date}：${v}kg</title></circle>`).join('');
  const labels = entries.map(([date], i) => i === 0 || i === entries.length - 1 || i === Math.floor((entries.length - 1) / 2) ? `<text x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="9" fill="#9aa59e">${date.slice(5)}</text>` : '').join('');
  chart.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="体重趋势图">${grid}${targetLine}<polyline points="${pts}" fill="none" stroke="#72a98c" stroke-width="2"/>${dots}${labels}</svg>`;
}

// ===== 消费统计图表 =====
let expenseStatsMonth = formatDate(new Date()).slice(0, 7);
function expenseStatsFor(month) {
  const days = [], incomeDays = [], top = [], incomeTop = [];
  let totalExpense = 0, totalIncome = 0, recordDays = 0;
  Object.entries(state.dailyRecords).forEach(([date, record]) => {
    if (!date.startsWith(month)) return;
    const e = expenseTotalFor(record), i = incomeTotalFor(record);
    if (e <= 0 && i <= 0) return;
    recordDays += 1; totalExpense += e; totalIncome += i;
    days.push([date, e]); incomeDays.push([date, i]);
    expenseItemsFor(record).forEach(item => { const amount = Number(item.amount) || 0; if (amount > 0) top.push({date, amount, note: item.note || ''}); });
    incomeItemsFor(record).forEach(item => { const amount = Number(item.amount) || 0; if (amount > 0) incomeTop.push({date, amount, note: item.note || ''}); });
  });
  days.sort((a, b) => a[0].localeCompare(b[0]));
  incomeDays.sort((a, b) => a[0].localeCompare(b[0]));
  top.sort((a, b) => b.amount - a.amount);
  incomeTop.sort((a, b) => b.amount - a.amount);
  return {days, incomeDays, top: top.slice(0, 5), incomeTop: incomeTop.slice(0, 5), totalExpense, totalIncome, recordDays};
}
function renderMoneyBarChart(amounts, dayCount, month, color) {
  const w = 720, h = 180, l = 36, r = 10, t = 14, b = 26, cw = w - l - r, ch = h - t - b;
  const maxV = Math.max(...amounts, 1);
  const bw = cw / dayCount;
  const bars = amounts.map((v, i) => { const bh = v / maxV * ch; return `<rect x="${(l + i * bw + bw * 0.15).toFixed(1)}" y="${(t + ch - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}" opacity="${v > 0 ? 0.85 : 0.25}"><title>${month}-${String(i + 1).padStart(2, '0')}：¥${v.toFixed(2)}</title></rect>`; }).join('');
  const labels = [1, 5, 10, 15, 20, 25, dayCount].filter(d => d <= dayCount).map(d => `<text x="${(l + (d - 0.5) * bw).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#9aa59e">${d}日</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="每日金额柱状图"><line x1="${l}" y1="${t + ch}" x2="${w - r}" y2="${t + ch}" stroke="#ecece6"/>${bars}${labels}</svg>`;
}
function moneyDaysAmounts(days, dayCount) {
  const amounts = Array.from({length: dayCount}, () => 0);
  days.forEach(([date, v]) => { amounts[Number(date.slice(8)) - 1] = v; });
  return amounts;
}
function renderExpenseStats() {
  const month = expenseStatsMonth;
  $('expenseMonthLabel').textContent = `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;
  const stats = expenseStatsFor(month);
  const dayCount = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  $('statExpenseTotal').textContent = `¥${stats.totalExpense.toFixed(2)}`;
  $('statIncomeTotal').textContent = `¥${stats.totalIncome.toFixed(2)}`;
  $('statExpenseAvg').textContent = `¥${(stats.recordDays ? stats.totalExpense / stats.recordDays : 0).toFixed(2)}`;
  $('statRecordDays').textContent = `${stats.recordDays} 天`;
  $('expenseBarChart').innerHTML = renderMoneyBarChart(moneyDaysAmounts(stats.days, dayCount), dayCount, month, '#72a98c');
  $('incomeBarChart').innerHTML = renderMoneyBarChart(moneyDaysAmounts(stats.incomeDays, dayCount), dayCount, month, '#e6a14e');
  const topList = items => items.length ? items.map(item => `<li><span>${escapeHtml(item.note || '未备注')}<small>${item.date.slice(5)}</small></span><strong>¥${item.amount.toFixed(2)}</strong></li>`).join('') : '<li class="empty">这个月还没有记录</li>';
  $('expenseTopList').innerHTML = topList(stats.top);
  $('incomeTopList').innerHTML = topList(stats.incomeTop);
}
function shiftExpenseMonth(amount) {
  const [y, m] = expenseStatsMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + amount, 1);
  expenseStatsMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderExpenseStats();
}

// ===== 番茄钟 =====
const POMODORO_KEY = 'pomodoroStateV1';
const pomodoro = {minutes: 25, taskId: '', endAt: 0, remaining: null, running: false, mode: 'focus'};
let pomodoroTimerId = null;
function savePomodoro() { try { localStorage.setItem(POMODORO_KEY, JSON.stringify({minutes: pomodoro.minutes, taskId: pomodoro.taskId, endAt: pomodoro.running ? pomodoro.endAt : 0, remaining: pomodoro.remaining, mode: pomodoro.mode})); } catch {} }
function loadPomodoro() {
  try {
    const saved = JSON.parse(localStorage.getItem(POMODORO_KEY));
    if (!saved) return;
    pomodoro.minutes = Number(saved.minutes) || 25;
    pomodoro.taskId = saved.taskId || '';
    pomodoro.remaining = Number.isFinite(saved.remaining) && saved.remaining > 0 ? saved.remaining : null;
    pomodoro.mode = saved.mode === 'break' ? 'break' : 'focus';
    if (saved.endAt && saved.endAt > Date.now()) { pomodoro.running = true; pomodoro.endAt = saved.endAt; }
    else if (saved.endAt && Date.now() - saved.endAt < 120000) { if (pomodoro.mode === 'break') finishBreak(true); else finishPomodoro(true); }
  } catch {}
}
function formatClock(totalSeconds) { const m = Math.floor(Math.max(totalSeconds, 0) / 60), s = Math.max(totalSeconds, 0) % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function pomodoroRemainingSeconds() { return pomodoro.running ? Math.round((pomodoro.endAt - Date.now()) / 1000) : (pomodoro.remaining != null ? Math.round(pomodoro.remaining / 1000) : pomodoro.minutes * 60); }
function updatePomodoroDisplay() {
  const seconds = pomodoroRemainingSeconds();
  const isBreak = pomodoro.mode === 'break';
  $('pomodoroDisplay').textContent = formatClock(seconds);
  $('pomodoroDisplay').classList.toggle('break', isBreak && pomodoro.running);
  document.title = pomodoro.running ? `${formatClock(seconds)} · ${isBreak ? '休息中' : '专注中'}` : '每日清单 · 让今天有迹可循';
  const badge = $('pomodoroFabBadge');
  badge.textContent = pomodoro.running ? formatClock(seconds) : '';
  badge.classList.toggle('hidden', !pomodoro.running);
}
function tickPomodoro() {
  if (pomodoro.running && Date.now() >= pomodoro.endAt) { if (pomodoro.mode === 'break') finishBreak(false); else finishPomodoro(false); return; }
  updatePomodoroDisplay();
}
function populatePomodoroTasks() {
  const select = $('pomodoroTask');
  const today = formatDate(new Date());
  const options = state.tasks.filter(t => t.date === today && !t.done).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`);
  select.innerHTML = '<option value="">不关联任务</option>' + options.join('');
  if (pomodoro.taskId && state.tasks.some(t => t.id === pomodoro.taskId)) select.value = pomodoro.taskId;
  else { select.value = ''; pomodoro.taskId = ''; }
}
async function finishPomodoro(fromBackground = false) {
  const minutes = pomodoro.minutes;
  pomodoro.running = false; pomodoro.remaining = null; pomodoro.endAt = 0;
  savePomodoro(); updatePomodoroDisplay();
  $('pomodoroStart').textContent = '开始专注';
  beep(3);
  pushNotification('🍅 番茄钟完成', `专注了 ${minutes} 分钟，起来活动一下吧！`);
  toast(`🍅 专注 ${minutes} 分钟完成！`);
  const task = state.tasks.find(t => t.id === pomodoro.taskId);
  let noteText = '';
  if (task && confirm(`专注完成！要把这 ${minutes} 分钟记录到任务「${task.title}」吗？`)) {
    try {
      const metrics = {...(task.metrics || {}), durationMinutes: Math.round(((Number(task.metrics?.durationMinutes) || 0) + minutes) * 10) / 10};
      await updateTask(task.id, {metrics});
      toast(`已为「${task.title}」记录 ${minutes} 分钟`);
    } catch (error) { toast(error.message); }
    noteText = `已记录 ${minutes} 分钟到「${task.title}」。`;
  } else {
    noteText = fromBackground ? '' : `本次专注 ${minutes} 分钟${task ? '（未记录到任务）' : ''}。`;
  }
  startBreak(noteText);
}
function startBreak(noteText = '') {
  pomodoro.mode = 'break';
  pomodoro.endAt = Date.now() + 5 * 60000;
  pomodoro.remaining = null;
  pomodoro.running = true;
  $('pomodoroStart').textContent = '暂停';
  $('pomodoroNote').textContent = `${noteText}正在休息 5 分钟，结束后会提醒你。`;
  savePomodoro(); updatePomodoroDisplay();
}
function finishBreak(fromBackground = false) {
  pomodoro.mode = 'focus';
  pomodoro.running = false; pomodoro.remaining = null; pomodoro.endAt = 0;
  $('pomodoroStart').textContent = '开始专注';
  savePomodoro(); updatePomodoroDisplay();
  beep(2);
  pushNotification('☕ 休息结束', '休息完毕，准备好就开始下一个番茄钟吧！');
  if (!fromBackground) toast('☕ 休息结束，开始下一轮吧');
  $('pomodoroNote').textContent = '休息结束！选一个任务，开始下一个番茄钟。';
}
$('pomodoroFab').onclick = () => {
  const panel = $('pomodoroPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) { populatePomodoroTasks(); updatePomodoroDisplay(); }
};
$('pomodoroClose').onclick = () => $('pomodoroPanel').classList.add('hidden');
document.querySelectorAll('.pomodoro-presets button').forEach(button => button.onclick = () => {
  if (pomodoro.running) { toast('专注进行中，先重置再切换时长'); return; }
  pomodoro.minutes = Number(button.dataset.minutes) || 25; pomodoro.remaining = null;
  document.querySelectorAll('.pomodoro-presets button').forEach(item => item.classList.toggle('active', item === button));
  savePomodoro(); updatePomodoroDisplay();
});
$('pomodoroStart').onclick = () => {
  if (pomodoro.running) { pomodoro.remaining = pomodoro.endAt - Date.now(); pomodoro.running = false; $('pomodoroStart').textContent = '继续'; toast('已暂停'); }
  else { pomodoro.endAt = Date.now() + (pomodoro.remaining != null && pomodoro.remaining > 0 ? pomodoro.remaining : pomodoro.minutes * 60000); pomodoro.remaining = null; pomodoro.running = true; $('pomodoroStart').textContent = '暂停'; }
  pomodoro.taskId = $('pomodoroTask').value;
  savePomodoro(); updatePomodoroDisplay();
};
$('pomodoroReset').onclick = () => {
  pomodoro.running = false; pomodoro.remaining = null; pomodoro.endAt = 0; pomodoro.mode = 'focus';
  $('pomodoroStart').textContent = '开始专注';
  savePomodoro(); updatePomodoroDisplay();
};

// ===== 任务提醒通知 =====
function reminderEnabled() { try { return localStorage.getItem('remindersEnabled') === '1'; } catch { return false; } }
function updateRemindButton() { const on = reminderEnabled(); const btn = $('remindBtn'); btn.textContent = on ? '🔔' : '🔕'; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
async function setReminderEnabled(on) {
  try { localStorage.setItem('remindersEnabled', on ? '1' : '0'); } catch {}
  updateRemindButton();
  if (on && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
}
function pushNotification(title, body) {
  toast(`${title} ${body}`);
  try { if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') new Notification(title, {body}); } catch {}
}
function minutesBetween(from, to) { const [fh, fm] = from.split(':').map(Number); const [th, tm] = to.split(':').map(Number); return th * 60 + tm - (fh * 60 + fm); }
function checkTaskReminders() {
  if (!reminderEnabled()) return;
  const today = formatDate(new Date());
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let notifiedStore = {};
  try { notifiedStore = JSON.parse(localStorage.getItem('notifiedTasks')) || {}; } catch {}
  const notified = new Set(notifiedStore[today] || []);
  state.tasks.filter(task => task.date === today && !task.done && /^\d{2}:\d{2}$/.test(task.time || '')).forEach(task => {
    if (!notified.has(task.id) && task.time <= currentTime && minutesBetween(task.time, currentTime) <= 30) {
      notified.add(task.id);
      pushNotification('⏰ 任务时间到', `${task.time} ${task.title}`);
    }
  });
  try { localStorage.setItem('notifiedTasks', JSON.stringify({[today]: [...notified]})); } catch {}
}
function beep(times = 2) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let delay = 0;
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.4);
      delay += 0.45;
    }
  } catch {}
}

// ===== 周报长图导出 =====
const MOOD_ICONS = {happy:'😊', calm:'😌', okay:'🙂', tired:'😮‍💨', sad:'😔'};
function buildWeeklyReportData() {
  const dates = weekDates(state.selectedDate);
  const dayStats = dates.map(date => { const s = taskStatsFor(date); return {date, total: s.total, done: s.done}; });
  const totalTasks = dayStats.reduce((sum, d) => sum + d.total, 0);
  const totalDone = dayStats.reduce((sum, d) => sum + d.done, 0);
  const rate = totalTasks ? Math.round(totalDone / totalTasks * 100) : 0;
  const minutesByCategory = {};
  state.tasks.filter(task => task.done && dates.includes(task.date)).forEach(task => { const cat = task.category || '其他'; minutesByCategory[cat] = (minutesByCategory[cat] || 0) + parseDuration(task); });
  const categoryRows = Object.entries(minutesByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const moodCounts = {};
  dates.forEach(date => { const mood = (state.dailyRecords[date] || {}).mood; if (mood && MOOD_ICONS[mood]) moodCounts[mood] = (moodCounts[mood] || 0) + 1; });
  return {dates, dayStats, totalTasks, totalDone, rate, categoryRows, moodCounts, streak: learningStreak(state.selectedDate)};
}
function buildWeeklySvg(r) {
  const W = 900, H = 1180;
  const parts = [];
  const text = (x, y, content, size, fill, weight = 400, anchor = 'start') => parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif">${content}</text>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`);
  parts.push(`<rect width="${W}" height="150" fill="#72a98c"/>`);
  text(60, 68, '✦ 每日清单 · 周成长报告', 34, '#ffffff', 800);
  text(60, 112, `${Number(r.dates[0].slice(5,7))}月${Number(r.dates[0].slice(8))}日 - ${Number(r.dates[6].slice(5,7))}月${Number(r.dates[6].slice(8))}日`, 20, '#eaf6ee');
  text(W - 60, 90, `完成率 ${r.rate}%`, 30, '#ffffff', 700, 'end');
  // 三张统计卡
  const cards = [['完成任务', `${r.totalDone}`, `共 ${r.totalTasks} 项`], ['连续学习', `${r.streak}`, '天'], ['本周打卡复盘', `${Object.values(r.moodCounts).reduce((a,b)=>a+b,0)}`, '天有心情记录']];
  cards.forEach(([label, value, sub], i) => {
    const x = 60 + i * 270;
    parts.push(`<rect x="${x}" y="190" width="240" height="130" rx="18" fill="#ffffff" stroke="#ecece6"/>`);
    text(x + 24, 232, label, 16, '#7c8981', 600);
    text(x + 24, 284, value, 40, '#35423e', 800);
    text(x + 24, 306, sub, 13, '#a5afa8');
  });
  // 每日完成柱状图
  text(60, 385, '每日任务完成', 22, '#35423e', 700);
  const chartL = 60, chartT = 410, chartH = 180, bw = 92, gap = (900 - 120 - 7 * bw) / 6;
  const maxDay = Math.max(...r.dayStats.map(d => d.total), 1);
  r.dayStats.forEach((d, i) => {
    const x = chartL + i * (bw + gap);
    const th = d.total / maxDay * chartH, dh = d.done / maxDay * chartH;
    parts.push(`<rect x="${x}" y="${chartT + chartH - th}" width="${bw}" height="${th}" rx="10" fill="#e2ece3"/>`);
    if (d.done > 0) parts.push(`<rect x="${x}" y="${chartT + chartH - dh}" width="${bw}" height="${dh}" rx="10" fill="#72a98c"/>`);
    text(x + bw / 2, chartT + chartH + 26, ['一','二','三','四','五','六','日'][i], 14, '#72798c', 600, 'middle');
    text(x + bw / 2, chartT + chartH + 48, `${d.done}/${d.total}`, 12, '#9aa59e', 400, 'middle');
  });
  // 分类投入
  const secY = 680;
  text(60, secY, '分类投入时长', 22, '#35423e', 700);
  const maxMinutes = Math.max(...r.categoryRows.map(([, m]) => m), 1);
  if (!r.categoryRows.length) text(60, secY + 36, '本周还没有完成的任务记录', 15, '#9aa59e');
  r.categoryRows.forEach(([category, minutes], i) => {
    const y = secY + 24 + i * 52;
    const w = Math.max(minutes / maxMinutes * 480, 8);
    parts.push(`<rect x="60" y="${y}" width="${w}" height="26" rx="13" fill="${colors[category] || '#8d96a9'}" opacity="0.85"/>`);
    text(60 + w + 14, y + 19, `${category} ${formatMinutes(minutes)}`, 15, '#4d6056', 600);
  });
  // 心情
  const moodY = 985;
  text(60, moodY, '本周心情', 22, '#35423e', 700);
  const moods = Object.entries(r.moodCounts).sort((a, b) => b[1] - a[1]);
  if (!moods.length) text(60, moodY + 40, '还没有心情记录', 15, '#9aa59e');
  moods.forEach(([mood, count], i) => {
    const x = 60 + i * 160;
    parts.push(`<rect x="${x}" y="${moodY + 18}" width="140" height="70" rx="16" fill="#f8fbf4" stroke="#edf2e7"/>`);
    text(x + 70, moodY + 50, MOOD_ICONS[mood], 22, '#35423e', 400, 'middle');
    text(x + 70, moodY + 76, `${moodLabel(mood)} ${count}天`, 13, '#7c8981', 500, 'middle');
  });
  text(W / 2, H - 55, '一次只专注一件事，完成比完美更重要。', 17, '#579578', 600, 'middle');
  text(W / 2, H - 25, `生成于 ${formatDate(new Date())} · 每日清单`, 12, '#a5afa8', 400, 'middle');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
function exportWeeklyImage() {
  const report = buildWeeklyReportData();
  const svg = buildWeeklySvg(report);
  const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml;charset=utf-8'}));
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = 900 * scale; canvas.height = 1180 * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(png => {
      if (!png) { toast('图片生成失败，请重试'); return; }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(png);
      link.download = `周报-${report.dates[0]}至${report.dates[6]}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 3000);
      toast('📷 周报长图已保存到下载');
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('图片生成失败，请重试'); };
  img.src = url;
}

function openModal(task = null) { state.editingId = task?.id || null; $('modalTitle').textContent = task ? '编辑任务' : '新建任务'; $('taskTitle').value = task?.title || ''; $('taskDate').value = task?.date || state.selectedDate; $('taskTime').value = task?.time || ''; $('taskCategory').value = task?.category || '工作'; refreshSubcategories(task ? (task.category === '学习' ? (task.subject || task.type || task.subcategory || '未分类') : task.category === '工作' ? (task.work_type || task.type || task.subcategory || '未分类') : (task.sport_type || task.type || task.subcategory || '未分类')) : ''); renderTaskMetrics({...task?.metrics, durationMinutes:task?.duration || task?.metrics?.durationMinutes, distanceKm:task?.distance || task?.metrics?.distanceKm, count:task?.count || task?.metrics?.count, projectTimeMinutes:task?.metrics?.projectTimeMinutes || (task?.category === '工作' ? task?.duration : '')}, {...task, achievement:task?.achievement || ''}); $('taskPriority').value = task?.priority || 'normal'; $('taskNote').value = task?.note || ''; $('modalBackdrop').classList.remove('hidden'); setTimeout(() => $('taskTitle').focus(), 50); }
function closeModal() { $('modalBackdrop').classList.add('hidden'); state.editingId = null; }
function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>el.classList.remove('show'),2200); }
function closeMobileSidebar() { const sidebar = $('sidebarBackdrop')?.previousElementSibling; const backdrop = $('sidebarBackdrop'); const button = $('mobileMenuBtn'); sidebar?.classList.remove('is-open'); backdrop?.classList.remove('is-open'); backdrop?.setAttribute('aria-hidden', 'true'); button?.setAttribute('aria-expanded', 'false'); document.body.classList.remove('sidebar-open'); }
function toggleMobileSidebar() { const sidebar = $('sidebarBackdrop')?.previousElementSibling; const backdrop = $('sidebarBackdrop'); const button = $('mobileMenuBtn'); const open = !sidebar?.classList.contains('is-open'); sidebar?.classList.toggle('is-open', open); backdrop?.classList.toggle('is-open', open); backdrop?.setAttribute('aria-hidden', open ? 'false' : 'true'); button?.setAttribute('aria-expanded', open ? 'true' : 'false'); document.body.classList.toggle('sidebar-open', open); }
$('mobileMenuBtn').onclick = toggleMobileSidebar; $('sidebarBackdrop').onclick = closeMobileSidebar; document.querySelector('.sidebar').addEventListener('click', event => { if (event.target.closest('.nav-item,.category-item')) closeMobileSidebar(); });

$('addTaskBtn').onclick = () => openModal(); $('emptyAddBtn').onclick = () => openModal(); $('closeModal').onclick = closeModal; $('cancelModal').onclick = closeModal;
$('addGoalBtn').onclick = () => openGoalModal(); $('emptyGoalBtn').onclick = () => openGoalModal(); $('closeGoalModal').onclick = closeGoalModal; $('cancelGoalModal').onclick = closeGoalModal; $('goalCategory').onchange = () => renderGoalMetricOptions($('goalMetric').value); $('goalMetric').onchange = () => { const info = goalMetricInfo({category:$('goalCategory').value, metric:$('goalMetric').value}); $('goalUnit').textContent = info.unit; }; $('goalModalBackdrop').onclick = event => { if (event.target === $('goalModalBackdrop')) closeGoalModal(); }; $('goalForm').onsubmit = async event => { event.preventDefault(); const payload = inferGoalPayload(); if (!payload.name || !Number.isFinite(payload.targetValue) || payload.targetValue <= 0) { toast('请填写有效的目标名称和目标数值'); return; } if (payload.category === '减肥' && (!Number.isFinite(payload.startWeight) || payload.startWeight <= 0)) { toast('请先在每日记录中填写有效体重'); return; } if (payload.category === '减肥' && payload.targetValue >= payload.startWeight) { toast('目标体重应低于起始体重'); return; } try { const editing = Boolean(state.editingGoalId); if (editing) await updateGoal(state.editingGoalId, payload); else await addGoal(payload); closeGoalModal(); toast(editing ? '目标已更新' : '目标已创建'); } catch (error) { toast(error.message); } }; $('goalsList').onclick = async event => { const button = event.target.closest('[data-goal-action]'); if (!button) return; const goal = state.goals.find(item => item.id === button.dataset.id); if (!goal) return; if (button.dataset.goalAction === 'edit') openGoalModal(goal); else if (confirm('确定要删除这个目标吗？')) { try { await deleteGoal(goal.id); } catch (error) { toast(error.message); } } };
function currentMoneyItems(selector) { return [...document.querySelectorAll(selector)].map(row => ({amount:row.querySelector('[class$="-amount"]').value === '' ? '' : Number(row.querySelector('[class$="-amount"]').value), note:row.querySelector('[class$="-note"]').value.trim()})).filter(item => item.amount !== '' || item.note); }
function currentExpenseItems() { return currentMoneyItems('#expenseList .expense-row'); }
function currentIncomeItems() { return currentMoneyItems('#incomeList .income-row'); }
function reviewPayload() {
  return {
    date: state.selectedDate,
    mood: document.querySelector('.mood-option.selected')?.dataset.mood || '',
    reviewHighlights: $('reviewHighlights').value.trim(),
    reviewChallenges: $('reviewChallenges').value.trim(),
    reviewGratitude: $('reviewGratitude').value.trim(),
    reviewTomorrow: $('reviewTomorrow').value.trim(),
    reviewSummary: $('reviewSummary').value.trim(),
    special: $('specialDay').checked,
    specialLabel: $('specialLabel').value.trim(),
    breakfast: $('breakfast').value.trim(),
    lunch: $('lunch').value.trim(),
    dinner: $('dinner').value.trim(),
    weight: $('weight').value === '' ? '' : Number($('weight').value),
    expenseItems: currentExpenseItems(),
    incomeItems: currentIncomeItems(),
    tasks: state.tasks.filter(task => task.date === state.selectedDate).map(task => ({title:task.title, done:task.done, time:task.time || '', category:task.category, subcategory:task.subcategory || task.type || '', type:task.type || task.subcategory || '', sport_type:task.sport_type || (task.category === '健康' ? task.type || '' : ''), work_type:task.work_type || (task.category === '工作' ? task.type || '' : ''), duration:task.duration || '', distance:task.distance || '', count:task.count || '', subject:task.subject || '', project:task.project || '', achievement:task.achievement || '', metrics:task.metrics || {}, priority:task.priority, note:task.note || ''}))
  };
}
$('saveRecordBtn').onclick = async () => { const payload = {special:$('specialDay').checked, specialLabel:$('specialLabel').value.trim(), breakfast:$('breakfast').value.trim(), lunch:$('lunch').value.trim(), dinner:$('dinner').value.trim(), weight:$('weight').value === '' ? '' : Number($('weight').value), expenseItems:currentExpenseItems(), incomeItems:currentIncomeItems()}; try { const record = await request(`/api/days/${state.selectedDate}`, {method:'PUT', body:JSON.stringify(payload)}); state.dailyRecords[state.selectedDate] = record; render(); toast('今日记录已保存'); } catch(error) { toast(error.message); } };
$('saveReviewBtn').onclick = async () => { const payload = {...reviewPayload(), generatedReview:state.generatedReview}; delete payload.date; delete payload.special; delete payload.specialLabel; delete payload.breakfast; delete payload.lunch; delete payload.dinner; delete payload.weight; delete payload.expenseItems; delete payload.incomeItems; delete payload.tasks; try { const record = await request(`/api/days/${state.selectedDate}`, {method:'PUT', body:JSON.stringify(payload)}); state.dailyRecords[state.selectedDate] = record; render(); toast('每日复盘已保存'); } catch(error) { toast(error.message); } };
$('generateReviewBtn').onclick = async () => { const button = $('generateReviewBtn'); button.disabled = true; button.textContent = '正在生成…'; try { const result = await request(AI_REVIEW_ENDPOINT, {method:'POST', body:JSON.stringify(reviewPayload())}); state.generatedReview = result.review || result; renderGeneratedReview(state.generatedReview); toast('复盘建议已生成，请确认后保存'); } catch(error) { toast(error.message); } finally { button.disabled = false; button.textContent = '✦ AI 生成复盘'; } };
$('generateGrowthReportBtn').onclick = async () => { const button = $('generateGrowthReportBtn'); const payload = growthReportPayload(); button.disabled = true; button.textContent = '正在生成…'; try { const result = await request('/api/ai/growth-report', {method:'POST', body:JSON.stringify(payload)}); state.growthReport = result.report || result; state.growthReports[growthReportKey(payload)] = state.growthReport; saveGrowthReports(); renderGrowthReport(); toast('本周成长报告已生成'); } catch(error) { toast(error.message); } finally { button.disabled = false; button.textContent = growthReportButtonText(); } };
document.querySelectorAll('.mood-option').forEach(button => button.onclick = () => { document.querySelectorAll('.mood-option').forEach(item => item.classList.remove('selected')); button.classList.add('selected'); });
$('addHabitBtn').onclick = async () => {
  const name = (prompt('习惯名称（例如：背单词、跳绳、阅读）') || '').trim();
  if (!name) return;
  let category = (prompt('所属分类（学习 / 健康 / 工作 / 生活 / 其他）', '学习') || '').trim();
  if (!categories.includes(category)) category = '学习';
  const subOptions = subcategories[category] || [];
  let subcategory = (prompt(`子分类（可选，可填：${subOptions.join(' / ')}）`, '') || '').trim();
  if (!subOptions.includes(subcategory)) subcategory = '';
  const timeInput = (prompt('每天固定时间（可选，格式 HH:MM，直接留空跳过）', '') || '').trim();
  const time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeInput) ? timeInput.padStart(5, '0') : '';
  try {
    const habit = await request('/api/habits', {method:'POST', body:JSON.stringify({name, category, subcategory, time})});
    state.habits.push(habit);
    render();
    toast('习惯已添加，点击卡片即可打卡');
  } catch (error) { toast(error.message); }
};
$('habitList').onclick = async event => {
  const remove = event.target.closest('.habit-delete');
  const chip = event.target.closest('[data-habit]');
  if (!chip) return;
  const habit = state.habits.find(item => item.id === chip.dataset.habit);
  if (!habit) return;
  if (remove) {
    if (!confirm(`删除习惯「${habit.name}」？已生成的任务会保留。`)) return;
    try { await request(`/api/habits/${habit.id}`, {method:'DELETE'}); state.habits = state.habits.filter(item => item.id !== habit.id); render(); toast('习惯已删除'); } catch (error) { toast(error.message); }
    return;
  }
  await toggleHabitCheckin(habit);
};
$('openExpenseStatsBtn').onclick = () => { $('expenseModalBackdrop').classList.remove('hidden'); renderExpenseStats(); };
$('openIncomeStatsBtn').onclick = () => { $('expenseModalBackdrop').classList.remove('hidden'); renderExpenseStats(); };
$('closeExpenseModal').onclick = () => $('expenseModalBackdrop').classList.add('hidden');
$('expenseModalBackdrop').onclick = event => { if (event.target === $('expenseModalBackdrop')) $('expenseModalBackdrop').classList.add('hidden'); };
$('prevExpenseMonth').onclick = () => shiftExpenseMonth(-1);
$('nextExpenseMonth').onclick = () => shiftExpenseMonth(1);
$('remindBtn').onclick = async () => { const next = !reminderEnabled(); await setReminderEnabled(next); toast(next ? '🔔 任务提醒已开启（保持页面打开才会提醒）' : '🔕 任务提醒已关闭'); };
$('exportTasksBtn').onclick = () => { window.open('/api/export?type=tasks'); toast('任务表格已开始下载'); };
$('exportDaysBtn').onclick = () => { window.open('/api/export?type=days'); toast('生活记录表格已开始下载'); };
$('exportReportImageBtn').onclick = exportWeeklyImage;
$('addExpenseBtn').onclick = addExpenseRow; $('addIncomeBtn').onclick = addIncomeRow; $('expenseList').oninput = updateExpenseTotal; $('incomeList').oninput = updateIncomeTotal; $('expenseList').onclick = event => { const button = event.target.closest('.expense-delete'); if (!button) return; button.closest('.expense-row').remove(); const hasRows = document.querySelectorAll('#expenseList .expense-row').length > 0; $('expenseEmpty').classList.toggle('hidden', hasRows); updateExpenseTotal(); }; $('incomeList').onclick = event => { const button = event.target.closest('.income-delete'); if (!button) return; button.closest('.income-row').remove(); const hasRows = document.querySelectorAll('#incomeList .income-row').length > 0; $('incomeEmpty').classList.toggle('hidden', hasRows); updateIncomeTotal(); };
$('modalBackdrop').onclick = e => { if(e.target === $('modalBackdrop')) closeModal(); };
$('taskCategory').onchange = () => { refreshSubcategories(); renderTaskMetrics(); }; $('taskSubcategory').onchange = () => { if ($('taskCategory').value === '学习' && $('metricSubject')) $('metricSubject').value = $('taskSubcategory').value; };
$('statsBackBtn').onclick = () => { if (state.statsType) { state.statsType = null; renderStatsDetail(); } else { state.statsCategory = null; renderStatsDetail(); } };
$('taskForm').onsubmit = async e => { e.preventDefault(); const payload={title:$('taskTitle').value,date:$('taskDate').value,time:$('taskTime').value,category:$('taskCategory').value,subcategory:$('taskSubcategory').value,type:$('taskSubcategory').value,sport_type:$('taskCategory').value === '健康' ? $('taskSubcategory').value : '',...currentTaskDimensions(),metrics:currentTaskMetrics(),priority:$('taskPriority').value,note:$('taskNote').value}; try { const wasEditing = Boolean(state.editingId); if(wasEditing) await updateTask(state.editingId,payload); else await addTask(payload); state.selectedDate=payload.date; closeModal(); toast(wasEditing?'任务已更新':'任务已添加'); } catch(error){ toast(error.message); } };
$('taskList').onclick = async e => { const button=e.target.closest('[data-action]'); if(!button) return; const id=button.dataset.id; const task=state.tasks.find(t=>t.id===id); if(button.dataset.action==='toggle') { try { await updateTask(id,{done:!task.done}); } catch(error){toast(error.message);} } else { const action=confirm('点击“确定”编辑任务，点击“取消”删除任务。'); if(action) openModal(task); else if(confirm('确定要删除这个任务吗？')) deleteTask(id); } };
$('prevDay').onclick=()=>shiftDate(-1); $('nextDay').onclick=()=>shiftDate(1); $('backToday').onclick=()=>{state.selectedDate=formatDate(new Date());state.category='all';render();}; $('datePickerBtn').onclick=()=>{ $('datePicker').showPicker?.(); $('datePicker').click(); }; $('datePicker').onchange=e=>{if(e.target.value){state.selectedDate=e.target.value;state.category='all';render();}};
function shiftDate(amount){ const d=dateObj(state.selectedDate); d.setDate(d.getDate()+amount); state.selectedDate=formatDate(d); state.category='all'; render(); }
document.querySelectorAll('.filter-tab').forEach(el=>el.onclick=()=>{state.filter=el.dataset.filter;render();}); $('searchInput').oninput=e=>{state.query=e.target.value;render();}; $('themeBtn').onclick=()=>document.body.classList.toggle('dark'); $('addCategoryBtn').onclick=()=>toast('分类可在任务编辑时选择');
document.querySelector('[data-view="stats"]').onclick = () => { state.view = 'stats'; state.category = 'all'; state.statsCategory = null; state.statsType = null; render(); };
document.querySelector('[data-view="today"]').onclick = () => { state.view = 'today'; render(); };
document.querySelector('[data-view="all"]').onclick = () => { state.view = 'today'; state.filter = 'all'; state.category = 'all'; render(); };
document.querySelector('[data-view="goals"]').onclick = () => { state.view = 'goals'; state.category = 'all'; state.statsCategory = null; state.statsType = null; render(); };
document.querySelector('[data-view="english"]').onclick = () => { state.view = 'english'; state.category = 'all'; render(); };
const hour=new Date().getHours(); $('greeting').textContent = hour<6?'夜深了，明天也会是崭新的一天':hour<12?'早上好，今天也要元气满满':hour<18?'下午好，保持专注，稳稳推进':'晚上好，辛苦了，记得好好休息';
updateRemindButton();
if ('serviceWorker' in navigator && window.isSecureContext) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
loadPomodoro();
if (pomodoro.running) { $('pomodoroStart').textContent = '暂停'; }
pomodoroTimerId = setInterval(tickPomodoro, 500);
checkTaskReminders();
setInterval(checkTaskReminders, 30000);
load();
/* ==================== AI 英语教练模块 ==================== */
function engStore() {
  const store = state.english && typeof state.english === 'object' ? state.english : {};
  if (!store.plans || typeof store.plans !== 'object') store.plans = {};
  if (!store.words || typeof store.words !== 'object') store.words = {};
  if (!store.wrongWords || typeof store.wrongWords !== 'object') store.wrongWords = {};
  if (!store.log || typeof store.log !== 'object') store.log = {};
  if (!Array.isArray(store.sessions)) store.sessions = [];
  if (!store.favorites || typeof store.favorites !== 'object') store.favorites = {};
  return store;
}
function engTtsPrefs() { try { return {lang: localStorage.getItem('engVoiceLang') || 'en-US', rate: Number(localStorage.getItem('engRate')) || 0.92}; } catch (error) { return {lang:'en-US', rate:0.92}; } }
function engSpeak(text, lang = 'en-US') {
  if (!('speechSynthesis' in window) || !text) { toast('当前浏览器不支持语音朗读'); return; }
  speechSynthesis.cancel();
  const prefs = engTtsPrefs();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en-US' ? prefs.lang : lang; utterance.rate = prefs.rate;
  speechSynthesis.speak(utterance);
}
function engLevelLabel(level) { return {cet4:'四级',cet6:'六级',kaoyan:'考研',ielts:'雅思',daily:'日常'}[level] || '四级'; }
function engReviewedToday(entry) { const today = formatDate(new Date()); return Boolean(entry && entry.lastReviewAt && String(entry.lastReviewAt).slice(0,10) === today); }
function engActiveWrongCount() { return Object.values(engStore().wrongWords).filter(item => item && !item.mastered).length; }
function engTodayDueCount() {
  const today = formatDate(new Date());
  const store = engStore();
  const wrongKeys = new Set(Object.keys(store.wrongWords).filter(k => store.wrongWords[k] && !store.wrongWords[k].mastered));
  return Object.entries(store.words).filter(([k, w]) => w && w.status !== 'mastered' && String(w.nextReviewAt || '').slice(0,10) <= today && !wrongKeys.has(k)).length;
}

function renderEnglish() {
  $('engNavCount').textContent = engActiveWrongCount() + engTodayDueCount();
  const store = engStore();
  $('engWordTotal').textContent = Object.keys(store.words).length;
  $('engWrongTotal').textContent = engActiveWrongCount();
  $('engFavTotal').textContent = Object.keys(store.favorites).length;
  document.querySelectorAll('.eng-tab').forEach(el => el.classList.toggle('active', el.dataset.engTab === state.engTab));
  ['plan','words','wrong','speaking','favs','stats'].forEach(tab => $(`engPanel${tab[0].toUpperCase()}${tab.slice(1)}`).classList.toggle('hidden', state.engTab !== tab));
  renderEngPlan(); renderEngWords(); renderEngWrong(); renderEngChat(); renderEngFavs(); renderEngStats();
}

function renderEngPlan() {
  const date = state.selectedDate;
  const plan = engStore().plans[date];
  const content = $('engPlanContent');
  if (!plan) { content.innerHTML = `<div class="empty-state"><div class="empty-illustration">✎</div><h3>${dateText(date)}还没有英语任务</h3><p>选择目标水平，点击上方按钮，让 AI 为你定制今天的单词、句子和口语话题。</p></div>`; $('engPlanTip').classList.add('hidden'); const dueBar = $('engDueBar'); dueBar.classList.add('hidden'); return; }
  const dueCount = engTodayDueCount();
  const dueBar = $('engDueBar');
  if (dueCount > 0) {
    dueBar.classList.remove('hidden');
    dueBar.innerHTML = `<span>📅 有 <b>${dueCount}</b> 个单词今天该复习了</span><button class="primary-button" id="engDueReviewBtn" type="button">开始复习</button>`;
    $('engDueReviewBtn').onclick = () => engStartQuiz('choice', engDueItems());
  } else { dueBar.classList.add('hidden'); dueBar.innerHTML = ''; }
  const wordsHtml = (plan.words || []).map(entry => {
    const record = engStore().words[(entry.word || '').toLowerCase()] || {};
    const reviewed = engReviewedToday(record);
    const dueToday = !reviewed && record.nextReviewAt && String(record.nextReviewAt).slice(0,10) <= date;
    return `<article class="eng-word-card ${reviewed ? 'reviewed' : ''}">
      <div class="eng-word-head"><strong>${escapeHtml(entry.word)}</strong><span class="eng-phonetic">${escapeHtml(entry.phonetic || '')}</span>
        <button class="icon-button eng-speak-btn" data-say="${escapeHtml(entry.word)}" title="朗读单词">🔊</button></div>
      <p class="eng-meaning">${escapeHtml(entry.meaning || '')}</p>
      ${entry.example ? `<p class="eng-example">${escapeHtml(entry.example)}</p><p class="eng-example-cn">${escapeHtml(entry.exampleTranslation || '')}</p>` : ''}
      <div class="eng-word-actions">
        <button type="button" class="eng-review-btn know" data-review="correct" data-word="${escapeHtml(entry.word)}" ${reviewed ? 'disabled' : ''}>✓ 认识</button>
        <button type="button" class="eng-review-btn wrong" data-review="wrong" data-word="${escapeHtml(entry.word)}" ${reviewed ? 'disabled' : ''}>✗ 不认识</button>
        <span class="eng-review-state">${reviewed ? (Number(record.wrongCount||0) > Number(record.correctCount||0) ? '今天已复习 · 答错过' : '今天已复习 ✓') : dueToday ? `📅 到期复习 · 已学 ${record.reviewCount || 0} 次` : `已学 ${record.reviewCount || 0} 次`}</span>
      </div></article>`;
  }).join('');
  const sentence = plan.sentence || {};
  const speaking = plan.speaking || {};
  const sentenceFaved = Boolean((sentence.text || '') && Object.values(engStore().favorites || {}).find(f => f.text === sentence.text));
  const completeControl = date === formatDate(new Date())
    ? `<button class="eng-complete-btn ${plan.completed ? 'done' : ''}" id="engCompleteBtn" type="button">${plan.completed ? '✓ 今日已完成' : '标记今日完成'}</button>`
    : (plan.completed ? '<span class="generated-source">✓ 已完成</span>' : '');
  content.innerHTML = `
    <section class="chart-card eng-plan-meta"><div><h3>今日任务单 · ${engLevelLabel(plan.level)}</h3><p>6个核心单词 · 1个长难句 · 1个口语话题</p></div><div class="eng-plan-meta-side"><span class="generated-source">${plan.source === 'ai' ? 'DeepSeek AI 生成' : '本地词库生成'}</span>${completeControl}</div></section>
    <div class="eng-word-grid">${wordsHtml}</div>
    <section class="chart-card eng-sentence-card"><div class="chart-header"><div><span class="eyebrow">DAILY SENTENCE</span><h3>每日一句</h3></div><div class="eng-plan-meta-side"><button class="icon-button" id="engReadBtn" title="跟读这句，测测发音">🎙 跟读</button><button class="icon-button eng-fav-btn ${sentenceFaved ? 'active' : ''}" data-fav="${escapeHtml(sentence.text || '')}" title="${sentenceFaved ? '取消收藏' : '收藏句子'}">${sentenceFaved ? '❤' : '♡'}</button><button class="icon-button eng-speak-btn" data-say="${escapeHtml(sentence.text || '')}" title="朗读句子">🔊</button></div></div>
      <blockquote class="eng-sentence">${escapeHtml(sentence.text || '')}</blockquote>
      <p class="eng-example-cn">${escapeHtml(sentence.translation || '')}</p>
      ${(sentence.points || []).length ? `<ul class="eng-points">${sentence.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
      <div id="engReadResult" class="eng-read-result"></div></section>
    ${(plan.story && plan.story.text) ? `<section class="chart-card eng-story-card"><div class="chart-header"><div><span class="eyebrow">WORD STORY</span><h3>今日单词小故事</h3></div><button class="icon-button eng-speak-btn" data-say="${escapeHtml(plan.story.text)}" title="朗读故事">🔊</button></div>
      <blockquote class="eng-story">${escapeHtml(plan.story.text)}</blockquote>
      ${plan.story.translation ? `<p class="eng-example-cn">${escapeHtml(plan.story.translation)}</p>` : ''}
      <p class="eng-scene">把今天的单词都藏进去了，读完故事等于复习一遍 📖</p></section>` : ''}
    <section class="chart-card eng-topic-card"><div class="chart-header"><div><span class="eyebrow">SPEAKING PRACTICE</span><h3>今日口语话题</h3><p class="eng-scene">${escapeHtml(speaking.scene || '')}</p></div></div>
      <p class="eng-sentence">${escapeHtml(speaking.topic || '')}</p>
      ${speaking.starter ? `<p class="eng-example">开场参考：${escapeHtml(speaking.starter)}</p>` : ''}
      <button class="primary-button" id="engGoSpeakingBtn">💬 开始口语练习</button></section>`;
  $('engPlanTip').textContent = plan.tip || '';
  $('engPlanTip').classList.toggle('hidden', !plan.tip);
  $('engGoSpeakingBtn').onclick = () => { $('engTopic').value = (engStore().plans[state.selectedDate]?.speaking?.topic) || ''; state.engTab = 'speaking'; renderEnglish(); };
  const completeBtn = $('engCompleteBtn');
  if (completeBtn) completeBtn.onclick = engTogglePlanComplete;
  const readBtn = $('engReadBtn');
  if (readBtn) readBtn.onclick = () => engStartReading(sentence.text || '');
}

let engReadRecognition = null;
function engNormalizeWords(t) { return String(t || '').toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean); }
function engScoreReading(target, said) {
  const t = engNormalizeWords(target), s = engNormalizeWords(said);
  if (!t.length) return;
  const m = t.length, n = s.length;
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = t[i-1] === s[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  let score = Math.round(dp[m][n] / m * 100);
  const matched = dp[m][n];
  const missing = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (t[i-1] === s[j-1]) { j--; i--; }
    else if (dp[i-1][j] >= dp[i][j-1]) { missing.unshift(t[i-1]); i--; }
    else j--;
  }
  while (i > 0) { missing.unshift(t[i-1]); i--; }
  const box = $('engReadResult');
  if (!box) return;
  box.innerHTML = score === 100 ? `🎯 得分 <b>100%</b> · 完美复述！🎉`
    : `🎯 得分 <b>${score}%</b> · 你说的是：“${escapeHtml(said)}”${missing.length ? `<br>漏读/不准：${missing.slice(0, 6).map(w => `<b>${escapeHtml(w)}</b>`).join('、')}${missing.length > 6 ? ' 等' : ''} · 点🔊再听一遍` : ''}`;
}
function engStartReading(text) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toast('当前浏览器不支持语音识别'); return; }
  if (!text) return;
  if (engReadRecognition) { engReadRecognition.stop(); engReadRecognition = null; return; }
  const rec = new Recognition();
  engReadRecognition = rec;
  rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
  const btn = $('engReadBtn'), box = $('engReadResult');
  btn.textContent = '🎙 聆听中…';
  if (box) box.innerHTML = '<p class="eng-scene">请大声读出上面的句子…</p>';
  rec.onresult = e => engScoreReading(text, e.results[0][0].transcript);
  rec.onerror = () => { toast('没有听清，靠近点再试一次'); if (box) box.innerHTML = ''; };
  rec.onend = () => { engReadRecognition = null; const b = $('engReadBtn'); if (b) b.textContent = '🎙 跟读'; };
  try { rec.start(); } catch (error) { engReadRecognition = null; }
}

async function engTogglePlanComplete() {
  const date = state.selectedDate;
  const plan = engStore().plans[date];
  if (!plan) return;
  const next = !plan.completed;
  try {
    await request('/api/english/plan/complete', {method:'POST', body:JSON.stringify({date, completed: next})});
    plan.completed = next;
    const log = engStore().log;
    if (!log[date]) log[date] = {newWords:0, correct:0, wrong:0, speakingMessages:0};
    log[date].planCompleted = Math.max(0, Number(log[date].planCompleted || 0) + (next ? 1 : -1));
    renderEnglish();
    toast(next ? '今日英语任务已完成 ✓ 保持打卡！' : '已取消完成标记');
  } catch (error) { toast(error.message); }
}

async function engReview(word, result) {
  try {
    const data = await request('/api/english/words/review', {method:'POST', body:JSON.stringify({word, result})});
    const store = engStore(); const key = word.toLowerCase();
    if (data.word) store.words[key] = data.word;
    if (result === 'correct') delete store.wrongWords[key];
    else if (!store.wrongWords[key]) store.wrongWords[key] = {word, meaning:(store.words[key]||{}).meaning||'', wrongCount:1};
    renderEnglish(); toast(result === 'correct' ? `「${word}」记入复习记录` : `「${word}」已加入错词本`);
  } catch (error) { toast(error.message); }
}

function renderEngWords() {
  const store = engStore();
  const query = state.engWordQuery.trim().toLowerCase();
  const entries = Object.values(store.words)
    .filter(item => !query || `${item.word} ${item.meaning}`.toLowerCase().includes(query))
    .sort((a,b) => (a.status === b.status ? (b.addedAt||'').localeCompare(a.addedAt||'') : a.status === 'mastered' ? 1 : -1));
  $('engWordsEmpty').classList.toggle('hidden', entries.length > 0);
  $('engWordList').innerHTML = entries.map(item => `<article class="eng-word-row ${item.status === 'mastered' ? 'mastered' : ''}">
    <button class="icon-button eng-speak-btn" data-say="${escapeHtml(item.word)}">🔊</button>
    <div class="eng-word-row-main"><strong>${escapeHtml(item.word)}</strong><span class="eng-phonetic">${escapeHtml(item.phonetic || '')}</span>
      <p>${escapeHtml(item.meaning || '')}${item.example ? ` <small>· ${escapeHtml(item.example)}</small>` : ''}</p></div>
    <div class="eng-word-row-side"><span class="tag 学习">${item.status === 'mastered' ? '已掌握' : '学习中'}</span>
      <small>对 ${item.correctCount || 0} / 错 ${item.wrongCount || 0}${item.nextReviewAt ? ` · ${item.nextReviewAt <= formatDate(new Date()) ? '今日该复习' : `下次 ${item.nextReviewAt.slice(5).replace('-', '/')}`}` : ''}</small>
      <button class="eng-delete-btn" data-del-word="${escapeHtml(item.word)}" title="删除">×</button></div></article>`).join('');
}

function renderEngWrong() {
  const store = engStore();
  const quizActive = Boolean(state.engQuiz);
  $('engQuizBtn').classList.toggle('hidden', quizActive);
  $('engSpellBtn').classList.toggle('hidden', quizActive);
  $('engQuizExit').classList.toggle('hidden', !quizActive);
  if (quizActive) { renderEngQuiz(); return; }
  const items = Object.values(store.wrongWords).sort((a,b) => Number(b.wrongCount||0) - Number(a.wrongCount||0));
  $('engWrongEmpty').classList.toggle('hidden', items.length > 0);
  $('engWrongList').innerHTML = items.map(item => `<article class="eng-wrong-row ${item.mastered ? 'mastered' : ''}">
    <button class="icon-button eng-speak-btn" data-say="${escapeHtml(item.word)}">🔊</button>
    <div class="eng-word-row-main"><strong>${escapeHtml(item.word)}</strong><p>${escapeHtml(item.meaning || '')}${item.reason ? ` <small>· 错因：${escapeHtml(item.reason)}</small>` : ''}</p></div>
    <div class="eng-word-row-side"><span class="tag 生活">${item.mastered ? '已掌握' : `错 ${item.wrongCount || 1} 次`}</span>
      <small>${recentDateLabel(item.lastWrongAt || '')}</small>
      <button class="secondary-button eng-wrong-action" data-wrong-toggle="${escapeHtml(item.word)}">${item.mastered ? '恢复' : '已掌握'}</button>
      <button class="eng-delete-btn" data-del-word="${escapeHtml(item.word)}" title="删除">×</button></div></article>`).join('');
}

function engBuildQueue(items) {
  const allWords = Object.values(engStore().words);
  const fallbackPool = ['option','develop','provide','require','suggest','achieve','consider','increase','reduce','support'];
  return items.map(item => {
    const pool = allWords.filter(w => String(w.word || '').toLowerCase() !== String(item.word).toLowerCase()).map(w => w.word);
    const distractors = [];
    while (distractors.length < 3 && pool.length) distractors.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    let fi = Math.floor(Math.random() * fallbackPool.length);
    while (distractors.length < 3) {
      const fw = fallbackPool[fi % fallbackPool.length]; fi += 1;
      if (fw.toLowerCase() !== String(item.word).toLowerCase() && !distractors.includes(fw)) distractors.push(fw);
    }
    const options = [item.word, ...distractors];
    for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
    return {word: item.word, meaning: item.meaning || '', options};
  });
}

function engDueItems() {
  const today = formatDate(new Date());
  const store = engStore();
  const wrongKeys = new Set(Object.keys(store.wrongWords).filter(k => store.wrongWords[k] && !store.wrongWords[k].mastered));
  return Object.values(store.words).filter(w => w && w.status !== 'mastered' && String(w.nextReviewAt || '').slice(0,10) <= today && !wrongKeys.has(w.word.toLowerCase()));
}

function engStartQuiz(mode = 'choice', items = null) {
  let active;
  if (Array.isArray(items)) {
    active = items;
    if (!active.length) { toast('没有需要复习的单词，明天再来吧'); return; }
  } else {
    active = Object.values(engStore().wrongWords).filter(item => item && !item.mastered)
      .sort((a,b) => Number(b.wrongCount||0) - Number(a.wrongCount||0)).slice(0, 10);
    if (!active.length) { toast('错词本是空的，先去今日任务里练几个词吧'); return; }
  }
  state.engQuiz = {queue: engBuildQueue(active.slice(0, 10)), index: 0, score: 0, picked: null, finished: false, mode};
  renderEnglish();
}

function renderEngQuiz() {
  const q = state.engQuiz;
  const box = $('engWrongList');
  $('engWrongEmpty').classList.add('hidden');
  if (q.finished) {
    box.innerHTML = `<section class="chart-card eng-quiz-card"><div class="eng-quiz-result">
      <h3>${q.score === q.queue.length ? '满分！全对 🎉' : `测验结束 · 答对 ${q.score} / ${q.queue.length}`}</h3>
      <p>${q.score >= q.queue.length * 0.8 ? '错词本快清空了，继续保持！' : '答错的词会留在错词本里，明天再来一轮。'}</p>
      <div class="eng-quiz-actions"><button class="primary-button" id="engQuizAgain">再来一轮</button><button class="secondary-button" id="engQuizClose">完成</button></div>
    </div></section>`;
    $('engQuizAgain').onclick = () => engStartQuiz();
    $('engQuizClose').onclick = () => { state.engQuiz = null; renderEnglish(); };
    return;
  }
  const item = q.queue[q.index];
  const revealed = Boolean(q.picked);
  const isRight = revealed && engNormalize(q.picked) === engNormalize(item.word);
  const spellMode = q.mode === 'spell';
  box.innerHTML = `<section class="chart-card eng-quiz-card">
    <div class="chart-header"><div><span class="eyebrow">WRONG WORD QUIZ</span><h3>第 ${q.index + 1} / ${q.queue.length} 题 · ${spellMode ? '听音拼写' : '看中文选单词'}</h3></div><span class="generated-source">得分 ${q.score}</span></div>
    ${spellMode
      ? `<div class="eng-spell-play"><button type="button" class="icon-button eng-speak-btn" data-say="${escapeHtml(item.word)}" title="再听一遍">🔊 再听一遍</button></div>
         <div class="eng-spell-row"><input id="engSpellInput" class="eng-spell-input" placeholder="拼写出你听到的单词" autocomplete="off" spellcheck="false" ${revealed ? 'disabled' : ''} value="${revealed ? escapeHtml(String(q.picked)) : ''}" /><button type="button" class="primary-button" id="engSpellSubmit" ${revealed ? 'disabled' : ''}>提交</button></div>`
      : `<p class="eng-quiz-meaning">${escapeHtml(item.meaning || '(该词暂无中文释义)')}</p>
         <div class="eng-quiz-options">${item.options.map(opt => {
           const correct = String(opt).toLowerCase() === String(item.word).toLowerCase();
           const cls = !revealed ? '' : correct ? 'correct' : (opt === q.picked ? 'incorrect' : '');
           return `<button type="button" class="eng-quiz-option ${cls}" data-quiz-pick="${escapeHtml(opt)}" ${revealed ? 'disabled' : ''}>${escapeHtml(opt)}</button>`;
         }).join('')}</div>`}
    ${revealed ? `<p class="eng-quiz-feedback ${isRight ? '' : 'wrong'}">${isRight ? (spellMode ? `✓ 拼对了：<b>${escapeHtml(item.word)}</b>` : '✓ 答对了！连续答对可自动掌握毕业') : `✗ 正确拼写：<b>${escapeHtml(item.word)}</b>${item.meaning ? `（${escapeHtml(item.meaning)}）` : ''}，已重新记入错词本`}</p>` : `<p class="eng-quiz-feedback">${spellMode ? '点击喇叭播放发音，不确定可以多听几遍' : '选出你认为正确的单词'}</p>`}
  </section>`;
  if (spellMode && !revealed) {
    engSpeak(item.word);
    const input = $('engSpellInput');
    $('engSpellSubmit').onclick = () => engQuizPick(input.value);
    input.onkeydown = event => { if (event.key === 'Enter') engQuizPick(input.value); };
    setTimeout(() => input.focus(), 50);
  }
}

async function engQuizPick(option) {
  const q = state.engQuiz;
  if (!q || q.picked) return;
  const item = q.queue[q.index];
  const correct = engNormalize(option) === engNormalize(item.word);
  q.picked = option;
  if (correct) q.score += 1;
  if (q.mode !== 'spell') engSpeak(item.word);
  try {
    const data = await request('/api/english/words/review', {method:'POST', body:JSON.stringify({word: item.word, result: correct ? 'correct' : 'wrong'})});
    const store = engStore(); const key = item.word.toLowerCase();
    if (data.word) store.words[key] = data.word;
    if (correct) delete store.wrongWords[key];
    else if (!store.wrongWords[key]) store.wrongWords[key] = {word: item.word, meaning: item.meaning || '', wrongCount: 1};
    else store.wrongWords[key].wrongCount = Number(store.wrongWords[key].wrongCount || 0) + 1;
  } catch {}
  renderEngWrong();
  setTimeout(() => {
    q.index += 1; q.picked = null;
    if (q.index >= q.queue.length) q.finished = true;
    if (state.engQuiz === q) renderEngWrong();
  }, 1200);
}

function engNormalize(text) { return String(text || '').trim().toLowerCase().replace(/[^a-z'-]/g, ''); }

function renderEngFavs() {
  const store = engStore();
  const items = Object.values(store.favorites).sort((a,b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  $('engFavEmpty').classList.toggle('hidden', items.length > 0);
  $('engFavList').innerHTML = items.map(f => `<article class="chart-card eng-sentence-card">
    <div class="chart-header"><div><span class="eyebrow">FAVORITE · ${escapeHtml(f.date || '')}</span></div><div class="eng-plan-meta-side"><button class="icon-button eng-speak-btn" data-say="${escapeHtml(f.text)}">🔊</button><button class="eng-delete-btn" data-fav-del="${escapeHtml(f.key)}" title="删除">×</button></div></div>
    <blockquote class="eng-sentence">${escapeHtml(f.text)}</blockquote>
    ${f.translation ? `<p class="eng-example-cn">${escapeHtml(f.translation)}</p>` : ''}
    ${(f.points || []).length ? `<ul class="eng-points">${f.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
  </article>`).join('');
}

function renderEngChat() {
  const chat = $('engChat');
  if (!state.engMessages.length) {
    chat.innerHTML = `<div class="eng-chat-empty"><b>AI 口语陪练</b><p>输入话题（如 job interview），然后用英语随便聊。<br>教练会用简单英文回复，并帮你纠正语法和用词错误。</p></div>`;
    return;
  }
  chat.innerHTML = state.engMessages.map(msg => msg.role === 'user'
    ? `<div class="eng-bubble user">${escapeHtml(msg.content)}</div>`
    : `<div class="eng-bubble coach">${escapeHtml(msg.content)}<button class="eng-replay-btn" data-say="${escapeHtml(msg.content)}" title="重听">🔊</button>
        ${(msg.corrections || []).map(c => `<div class="eng-correction"><b>✎ 更正：</b>${escapeHtml(c.original || '')} → <b>${escapeHtml(c.suggestion || '')}</b>${c.explanation ? `<span>${escapeHtml(c.explanation)}</span>` : ''}</div>`).join('')}</div>`).join('');
  chat.scrollTop = chat.scrollHeight;
}

function renderEngStats() {
  const store = engStore();
  const weekStart = (() => { const d = dateObj(state.selectedDate); d.setDate(d.getDate() - 6); return formatDate(d); })();
  const weekly = store.weeklyReports[weekStart] || store.weeklyReports[state.selectedDate];
  $('engWeeklyBox').innerHTML = weekly
    ? `<div class="eng-weekly-report ${weekly.source === 'ai' ? 'ai' : ''}"><p class="eng-weekly-summary">${escapeHtml(weekly.summary || '')}</p>
       ${(weekly.advice || []).map(a => `<p class="eng-weekly-advice">💡 ${escapeHtml(a)}</p>`).join('')}
       ${weekly.encouragement ? `<p class="eng-weekly-cheer">${escapeHtml(weekly.encouragement)}</p>` : ''}
       <small>新学 ${weekly.newWords || 0} 词 · 复习对/错 ${weekly.correct || 0}/${weekly.wrong || 0} · 口语 ${weekly.speakingMessages || 0} 条 · 打卡 ${weekly.planDays || 0} 天 · ${weekly.source === 'ai' ? 'AI 生成' : '本地生成'}</small></div>`
    : '<p class="eng-empty">还没有本周周报，点右上角按钮生成。</p>';
  const words = Object.values(store.words);
  const mastered = words.filter(w => w.status === 'mastered').length;
  $('engStatTotal').textContent = words.length;
  $('engStatLearnDetail').textContent = `学习中 ${words.length - mastered} · 已掌握 ${mastered}`;
  $('engStatBar').style.width = words.length ? `${Math.round(mastered / words.length * 100)}%` : '0%';
  const wrongItems = Object.values(store.wrongWords);
  const activeWrong = wrongItems.filter(item => !item.mastered);
  $('engStatWrong').textContent = activeWrong.length;
  $('engStatWrongDetail').textContent = `累计答错 ${wrongItems.reduce((sum,item) => sum + Number(item.wrongCount||0), 0)} 次`;
  const week = weekDates(state.selectedDate).filter(d => d <= state.selectedDate);
  const weekLogs = week.map(d => store.log[d] || {});
  const weekSpeaking = weekLogs.reduce((sum,l) => sum + Number(l.speakingMessages||0), 0);
  $('engStatSpeaking').textContent = `${weekSpeaking} 条`;
  $('engStatSpeakingDetail').textContent = weekSpeaking ? '本周开口练过了，继续保持' : '还没有开口练习';
  let streak = 0; const cursor = dateObj(state.selectedDate);
  const isActive = d => { const l = store.log[d] || {}; return Number(l.newWords||0) + Number(l.correct||0) + Number(l.wrong||0) + Number(l.speakingMessages||0) + Number(l.planCompleted||0) > 0; };
  while (isActive(formatDate(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  $('engStatStreak').innerHTML = `${streak} <b>天</b>`;
  const max = Math.max(...week.map(d => { const l = store.log[d] || {}; return Number(l.newWords||0) + Number(l.correct||0) + Number(l.wrong||0) + Math.round(Number(l.speakingMessages||0)/2); }), 4);
  $('engTrendChart').innerHTML = `<div class="eng-trend-bars">${week.map(d => {
    const l = store.log[d] || {};
    const nw = Number(l.newWords||0), rv = Number(l.correct||0) + Number(l.wrong||0), sp = Math.round(Number(l.speakingMessages||0)/2);
    const scale = v => v / max * 100;
    const label = `${dateObj(d).getMonth()+1}/${dateObj(d).getDate()}`;
    const total = nw + rv + sp;
    return `<div class="eng-trend-col" title="${label}：新学${nw} · 复习${rv} · 口语${sp}"><div class="eng-trend-stack">${total ? `<i class="t-new" style="height:${scale(nw)}%"></i><i class="t-review" style="height:${scale(rv)}%"></i><i class="t-speaking" style="height:${scale(sp)}%"></i>` : '<i class="t-empty"></i>'}</div><span>${label}</span></div>`;
  }).join('')}</div>
  <div class="eng-trend-legend"><span><i class="t-new"></i>新学</span><span><i class="t-review"></i>复习</span><span><i class="t-speaking"></i>口语(÷2)</span></div>`;
}

async function engGeneratePlan() {
  const button = $('engGenerateBtn');
  button.disabled = true; button.textContent = '✦ 正在生成…';
  try {
    const payload = {date: state.selectedDate, level: $('engLevel').value, focus: $('engFocus').value.trim()};
    const result = await request('/api/english/plan', {method:'POST', body:JSON.stringify(payload)});
    engStore().plans[payload.date] = result.plan;
    (result.newWordEntries || []).forEach(entry => { engStore().words[entry.word.toLowerCase()] = entry; });
    renderEnglish();
    toast(`今日英语任务已生成${result.newWords ? `，新收录 ${result.newWords} 个单词` : ''}`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '✦ AI生成今日任务'; }
}

async function engSend(messageText) {
  const message = (messageText ?? $('engChatInput').value).trim();
  if (!message) return;
  $('engChatInput').value = '';
  state.engMessages.push({role:'user', content:message});
  renderEngChat();
  $('engSendBtn').disabled = true;
  try {
    const history = state.engMessages.slice(0, -1).slice(-12);
    const result = await request('/api/english/speaking', {method:'POST', body:JSON.stringify({sessionId: state.engSessionId, topic: $('engTopic').value.trim() || 'Free talk', message, history})});
    state.engSessionId = result.id;
    state.engMessages.push({role:'coach', content:result.reply, corrections:result.corrections || []});
    engSpeak(result.reply);
  } catch (error) { state.engMessages.push({role:'coach', content:`（连接失败：${error.message}）`, corrections:[]}); }
  finally { $('engSendBtn').disabled = false; renderEngChat(); }
}

let engRecognition = null;
function engToggleMic() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toast('当前浏览器不支持语音识别，请直接输入文字'); return; }
  if (engRecognition) { engRecognition.stop(); engRecognition = null; $('engMicBtn').classList.remove('recording'); $('engMicHint').classList.add('hidden'); return; }
  engRecognition = new Recognition();
  engRecognition.lang = 'en-US'; engRecognition.interimResults = false;
  engRecognition.onresult = event => { const text = event.results[0][0].transcript; engRecognition = null; $('engMicBtn').classList.remove('recording'); $('engMicHint').classList.add('hidden'); engSend(text); };
  engRecognition.onerror = () => { engRecognition = null; $('engMicBtn').classList.remove('recording'); $('engMicHint').classList.add('hidden'); toast('没有听清，再试一次或直接输入文字'); };
  engRecognition.onend = () => { $('engMicBtn').classList.remove('recording'); };
  $('engMicBtn').classList.add('recording');
  $('engMicHint').textContent = '🎙 正在聆听…请用英语说话'; $('engMicHint').classList.remove('hidden');
  engRecognition.start();
}

document.querySelectorAll('.eng-tab').forEach(el => el.onclick = () => { state.engTab = el.dataset.engTab; renderEnglish(); });
$('engGenerateBtn').onclick = engGeneratePlan;
$('engQuizBtn').onclick = () => engStartQuiz('choice');
$('engSpellBtn').onclick = () => engStartQuiz('spell');
$('engQuizExit').onclick = () => { state.engQuiz = null; renderEnglish(); };
$('engWordSearch').oninput = e => { state.engWordQuery = e.target.value; renderEngWords(); };
$('engAddWordBtn').onclick = async () => {
  const word = (prompt('要添加的英文单词') || '').trim();
  if (!word) return;
  const meaning = (prompt('中文释义（可留空）', '') || '').trim();
  try { const saved = await request('/api/english/words', {method:'POST', body:JSON.stringify({word, meaning})}); engStore().words[saved.word.toLowerCase()] = saved; renderEnglish(); toast(`「${saved.word}」已加入词库`); } catch (error) { toast(error.message); }
};
document.addEventListener('click', async event => {
  if (state.view !== 'english') return;
  const say = event.target.closest('[data-say]');
  if (say) { engSpeak(say.dataset.say); return; }
  const quizPick = event.target.closest('[data-quiz-pick]');
  if (quizPick) { engQuizPick(quizPick.dataset.quizPick); return; }
  const fav = event.target.closest('[data-fav]');
  if (fav) {
    const store = engStore();
    const text = fav.dataset.fav;
    if (!text) return;
    const existing = Object.values(store.favorites).find(f => f.text === text);
    try {
      if (existing) {
        await request(`/api/english/sentence-favs/${encodeURIComponent(existing.key)}`, {method:'DELETE'});
        delete store.favorites[existing.key];
        toast('已取消收藏');
      } else {
        const plan = engStore().plans[state.selectedDate] || {};
        const sent = plan.sentence || {};
        const res = await request('/api/english/sentence-favs', {method:'POST', body:JSON.stringify({text, translation: sent.translation || '', points: sent.points || [], date: state.selectedDate, level: plan.level || ''})});
        if (res.favorite) store.favorites[res.favorite.key] = res.favorite;
        toast('句子已收藏 ❤');
      }
      renderEnglish();
    } catch (error) { toast(error.message); }
    return;
  }
  const favDel = event.target.closest('[data-fav-del]');
  if (favDel && confirm('删除这条收藏？')) {
    try { await request(`/api/english/sentence-favs/${encodeURIComponent(favDel.dataset.favDel)}`, {method:'DELETE'}); delete engStore().favorites[favDel.dataset.favDel]; renderEnglish(); } catch (error) { toast(error.message); }
    return;
  }
  const review = event.target.closest('[data-review]');
  if (review) { engReview(review.dataset.word, review.dataset.review); return; }
  const del = event.target.closest('[data-del-word]');
  if (del && confirm(`确定删除单词「${del.dataset.delWord}」？`)) {
    try { await request(`/api/english/words/${encodeURIComponent(del.dataset.delWord.toLowerCase())}`, {method:'DELETE'}); const store = engStore(); delete store.words[del.dataset.delWord.toLowerCase()]; delete store.wrongWords[del.dataset.delWord.toLowerCase()]; renderEnglish(); toast('单词已删除'); } catch (error) { toast(error.message); }
    return;
  }
  const toggle = event.target.closest('[data-wrong-toggle]');
  if (toggle) {
    const key = toggle.dataset.wrongToggle.toLowerCase(); const item = engStore().wrongWords[key];
    if (!item) return;
    try { const updated = await request(`/api/english/wrong-words/${encodeURIComponent(key)}`, {method:'PUT', body:JSON.stringify({mastered:!item.mastered})}); engStore().wrongWords[key] = updated; renderEnglish(); } catch (error) { toast(error.message); }
  }
});
$('engSendBtn').onclick = () => engSend();
$('engChatInput').onkeydown = event => { if (event.key === 'Enter') engSend(); };
$('engMicBtn').onclick = engToggleMic;
$('engExportBtn').onclick = () => { window.open('/api/export?type=english-words'); toast('词库 CSV 已开始下载'); };
$('engImportBtn').onclick = async () => {
  const raw = (prompt('每行一个单词（最多30个），例如：\nabandon\nsignificant\nreluctant') || '').trim();
  if (!raw) return;
  const words = raw.split(/[\n,，;；]+/).map(w => w.trim()).filter(Boolean);
  if (!words.length) { toast('没有识别到有效单词'); return; }
  toast(`正在导入 ${words.length} 个单词…`);
  try {
    const res = await request('/api/english/words/import', {method:'POST', body:JSON.stringify({words})});
    (res.entries || []).forEach(entry => { engStore().words[entry.word.toLowerCase()] = entry; });
    renderEnglish();
    toast(res.imported ? `成功导入 ${res.imported} 个单词${res.skipped ? `，跳过重复 ${res.skipped} 个` : ''}` : '这些单词都已在词库里啦');
  } catch (error) { toast(error.message); }
};
$('engWeeklyBtn').onclick = async () => {
  const btn = $('engWeeklyBtn');
  btn.disabled = true; btn.textContent = '✦ 正在生成…';
  try {
    const report = await request('/api/english/weekly-report', {method:'POST', body:'{}'});
    engStore().weeklyReports[report.weekStart] = report;
    state.engTab = 'stats';
    renderEnglish();
    toast('英语周报已生成 ✓');
  } catch (error) { toast(error.message); }
  finally { btn.disabled = false; btn.textContent = '✦ 生成本周周报'; }
};
(function initEngTts() { try {
  const savedRate = localStorage.getItem('engRate');
  const savedLang = localStorage.getItem('engVoiceLang');
  if (savedRate) $('engRate').value = savedRate;
  if (savedLang) $('engAccent').value = savedLang;
  $('engRate').onchange = e => { localStorage.setItem('engRate', e.target.value); toast('朗读语速已保存'); };
  $('engAccent').onchange = e => { localStorage.setItem('engVoiceLang', e.target.value); toast('口音已保存，马上听听看 🔊'); engSpeak('Hello, this is my favorite English sentence.'); };
} catch (error) {} })();
