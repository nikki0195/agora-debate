/* Agora 线上配置 ─────────────────────────────────────
 * 部署到 Render 后，把下面的 xxx 换成你的真实服务名
 * （形如 https://agora-api-a1b2c3.onrender.com）。
 *
 * 本地开发（localhost / 127.0.0.1 / file:// 双击打开）会自动跳过，
 * 走 location.origin，play.cmd 一键试玩不受影响。
 * ──────────────────────────────────────────────────── */
if (
  location.hostname !== 'localhost' &&
  location.hostname !== '127.0.0.1' &&
  location.hostname !== ''
) {
  window.__AGORA_API_BASE__ = 'https://agora-api-xxx.onrender.com';
}
