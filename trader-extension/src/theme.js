// 主题切换 - 必须为外部脚本（Chrome 扩展 CSP 禁止内联脚本）
(function () {
  const KEY = 'ft-theme';
  function init() {
    const saved = localStorage.getItem(KEY);
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
  }
  function toggle() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = next === 'dark' ? '☀' : '☾';
  }
  init();
  document.getElementById('themeToggle')?.addEventListener('click', toggle);
})();
