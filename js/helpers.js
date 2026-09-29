/* =============================================================================
 *  helpers.js —— 纯函数工具（不碰 DOM，可在 Node 里直接测）
 * -----------------------------------------------------------------------------
 *  从 ui.js 里拆出来，是为了让这些逻辑能被单元测试覆盖。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ 版式推荐 */

  /* 新建模块时按名称猜版式：命中第一条规则即返回。
     顺序有讲究 —— 「荣誉 / 校园 / 竞赛」这类必须排在「经历」之前，
     否则「校园经历」「竞赛获奖」会被 '经历'/'竞赛' 抢去判成时间线卡片。 */
  var SORT_RULES = [
    { re: /技能|能力|语言|工具|证书|特长|加分/, sort: 'tags' },
    { re: /教育|学历|学习经历|求学/, sort: 'timeline' },
    { re: /荣誉|奖项|奖学|获奖|校园|活动|兴趣|评价|自述|其他/, sort: 'list' },
    { re: /项目|工作|实习|经历|论文|专利|科研|竞赛|课题/, sort: 'cards' }
  ];

  var SORT_LABELS = {
    list: '要点列表',
    cards: '经历卡片',
    timeline: '时间线',
    tags: '标签'
  };

  /**
   * 根据模块名称推荐版式
   * @param {string} title
   * @returns {'list'|'cards'|'timeline'|'tags'}
   */
  function inferSort(title) {
    var t = String(title == null ? '' : title);
    for (var i = 0; i < SORT_RULES.length; i++) {
      if (SORT_RULES[i].re.test(t)) return SORT_RULES[i].sort;
    }
    return 'list';
  }

  function sortLabel(sort) {
    return SORT_LABELS[sort] || sort || '';
  }

  /* -------------------------------------------------------- 图片体积估算 */

  /**
   * data URL 的实际字节数。
   * base64 每 4 个字符表示 3 字节，末尾可能有 1~2 个 '=' 填充。
   * @param {string} dataUrl
   * @returns {number} 字节数；不是 data URL 时返回 0
   */
  function dataUrlBytes(dataUrl) {
    var s = String(dataUrl == null ? '' : dataUrl);
    var i = s.indexOf(',');
    if (i === -1 || s.indexOf('data:') !== 0) return 0;
    var body = s.slice(i + 1);
    var pad = (body.match(/=+$/) || [''])[0].length;
    var n = Math.floor(body.length * 3 / 4) - pad;
    return n > 0 ? n : 0;
  }

  /** 人读的体积文案 */
  function formatBytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
    return (v / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ------------------------------------------------------------ 数组工具 */

  /** 就地交换两个下标；越界时不动 */
  function swap(arr, i, j) {
    if (!arr || i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
    var t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
    return arr;
  }

  /* ------------------------------------------------------ 头像取景几何 */

  /**
   * 按「人脸中心」在源图里框出一块指定宽高比的裁剪区。
   *
   * 为什么需要它：头像显示成圆形/竖版，如果直接让 CSS 用 object-fit: cover 去裁，
   * 裁哪儿完全取决于一个写死的 object-position 百分比 —— 换个照片就歪了。
   * 所以改成在**上传时**就把裁剪烘焙进图片本身，CSS 只负责摆正。
   *
   * @param {Object} opts
   *   iw, ih      源图尺寸
   *   outW, outH  输出尺寸（决定宽高比）
   *   faceCx, faceCy  人脸中心在源图里的位置（没检测到就给 null，按人像常规取上中部）
   *   nudge       手动微调，-1 显示图像顶部 … +1 显示图像底部
   * @returns {{sx:number, sy:number, sw:number, sh:number}} 源图上的裁剪框
   */
  function cropRectFor(opts) {
    var o = opts || {};
    var iw = Math.max(1, Number(o.iw) || 1);
    var ih = Math.max(1, Number(o.ih) || 1);
    var outW = Math.max(1, Number(o.outW) || 3);
    var outH = Math.max(1, Number(o.outH) || 4);
    var targetRatio = outW / outH;
    var nudge = Math.max(-1, Math.min(1, Number(o.nudge) || 0));

    /* 1. 在源图里取最大的一块，宽高比等于目标比例 */
    var sw = iw, sh = iw / targetRatio;
    if (sh > ih) { sh = ih; sw = ih * targetRatio; }

    /* 2. 人脸位置：没给就按人像照的常规取「偏上」（头部大约在上三分之一处） */
    var fx = (o.faceCx == null) ? iw * 0.5 : Number(o.faceCx);
    var fy = (o.faceCy == null) ? ih * 0.37 : Number(o.faceCy);
    fx = Math.max(0, Math.min(iw, fx));
    fy = Math.max(0, Math.min(ih, fy));

    /* 3. 让人脸落在裁剪框里「从顶部往下 38%」的位置。
          证件照的常见构图就是头顶留一点空，五官略偏上，肩膀占下半部分。 */
    var sy = fy - sh * 0.38;
    var sx = fx - sw / 2;

    /* 4. 手动微调：nudge 为负 = 视线向上（裁剪框上移，露出更靠上的内容），
          为正 = 视线向下。±1 相当于让出半个框高。
          注意是「加」不是「减」：sy 增大代表裁剪框往下移。 */
    sy += nudge * sh * 0.5;

    /* 5. 贴边就夹住，保证裁剪框完整落在源图内 */
    sx = Math.max(0, Math.min(iw - sw, sx));
    sy = Math.max(0, Math.min(ih - sh, sy));

    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  /* ------------------------------------------------------------ 区块合并 */

  /**
   * 把「当前简历里已有的区块」和「本次识别出来的区块」合成一份列表，
   * 供「校对并应用」面板显示 —— 面板要能看到简历的**全部**模块，
   * 而不只是这次粘贴解析出来的那几个。
   *
   * 规则：
   *   - 先按现有区块的顺序铺开（这是页面上真实的顺序，也是操作的基准）
   *   - 同一 id 被本次识别覆盖时，用识别结果，但保留原来的位置
   *   - 本次识别出的新 id 追加到末尾
   *   - 空壳（没内容）的现有区块仍然列出，方便就地补内容
   *
   * @param {Array} existing 当前简历里的区块
   * @param {Array} parsed   本次识别出的区块
   * @returns {Array<{section:Object, fromParse:boolean}>}
   */
  function mergeSections(existing, parsed) {
    var ex = Array.isArray(existing) ? existing : [];
    var pa = Array.isArray(parsed) ? parsed : [];

    var parsedById = {};
    pa.forEach(function (s) { if (s && s.id) parsedById[s.id] = s; });

    var out = [];
    var used = {};

    ex.forEach(function (s) {
      if (!s || !s.id) return;
      used[s.id] = true;
      var hit = parsedById[s.id];
      out.push({ section: hit || s, fromParse: !!hit });
    });

    pa.forEach(function (s) {
      if (!s || !s.id || used[s.id]) return;
      used[s.id] = true;
      out.push({ section: s, fromParse: true });
    });

    return out;
  }

  var API = {
    SORT_RULES: SORT_RULES,
    SORT_LABELS: SORT_LABELS,
    inferSort: inferSort,
    sortLabel: sortLabel,
    dataUrlBytes: dataUrlBytes,
    formatBytes: formatBytes,
    swap: swap,
    cropRectFor: cropRectFor,
    mergeSections: mergeSections
  };

  global.ResumeHelpers = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
