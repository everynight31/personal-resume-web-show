/* =============================================================================
 *  skills.js —— 技术岗技能词表 + 技能抽取
 * -----------------------------------------------------------------------------
 *  用途：把「编程语言：C 语言、Java；可完成基础算法实现……」这类句子
 *        切成一个个标签，并判定主/次（main / aux）。
 *  维护：直接往对应数组里加词即可，长词优先匹配（见 entries()）。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 主要技能：硬技能，页面上用实心蓝标签突出 */
  var MAIN = [
    /* 编程语言 */
    'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'C 语言', 'C语言', 'C', 'Go', 'Golang',
    'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'Scala', 'R', 'MATLAB', 'SQL', 'Shell', 'Bash',
    'Verilog', 'VHDL', '汇编', 'LaTeX',
    /* 前端 */
    'Vue.js', 'Vue', 'React', 'Angular', 'Next.js', 'Nuxt', 'HTML', 'CSS', 'Sass', 'Less',
    'Webpack', 'Vite', 'Element Plus', 'ECharts', 'Three.js', 'Cesium', 'Tailwind',
    /* 后端与数据库 */
    'Node.js', 'Node', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'SpringBoot',
    'MySQL', 'PostgreSQL', 'Redis', 'MongoDB', 'SQLite', 'Oracle', 'Elasticsearch', 'Kafka',
    'RabbitMQ', 'Nginx', 'Docker', 'Kubernetes', 'K8s', 'Git', 'GitLab', 'Linux', 'Jenkins',
    'CI/CD', 'RESTful', 'GraphQL', 'WebSocket', 'gRPC', '微服务',
    /* 人工智能 */
    'PyTorch', 'TensorFlow', 'Keras', 'PaddlePaddle', 'Paddle', 'MindSpore', 'scikit-learn',
    'sklearn', 'OpenCV', 'NumPy', 'Pandas', 'Matplotlib', 'Jupyter', 'CUDA', 'YOLO', 'YOLOv5',
    'YOLOv8', 'Transformer', 'BERT', 'LLM', '大模型', 'RAG', 'LoRA', 'Diffusion', 'GAN',
    '深度学习', '机器学习', '强化学习', '迁移学习', '对抗训练', '目标检测', '图像处理',
    '图像分割', '语义分割', '实例分割', '姿态估计', 'OCR', '人脸识别', '语音识别', '语音合成',
    '自然语言处理', 'NLP', '计算机视觉', 'CV', '多模态', '知识图谱', '数据挖掘', '特征工程',
    '模型压缩', '模型量化', '知识蒸馏', '联邦学习', '边缘计算',
    /* 算法与数学 */
    '多目标优化', '遗传算法', '粒子群算法', '模拟退火', '蚁群算法', '动态规划', '贪心算法',
    '线性规划', '运筹优化', '路径规划', '数据结构', '操作系统', '计算机网络', '计算机组成原理',
    '概率统计', '数理统计', '数值分析', '线性代数', '最优化理论', '图论', '矩阵分析',
    /* 通信 / 电子 */
    '通信原理', '数字电路', '模拟电路', '信号与系统', '数字信号处理', '嵌入式', '单片机',
    'STM32', 'ESP8266', 'ESP32', 'Arduino', '树莓派', 'Raspberry Pi', 'FPGA', 'DSP', 'ARM',
    '51 单片机', 'PCB', 'Altium Designer', 'Keil', 'I2C', 'SPI', 'UART', 'CAN', 'MQTT',
    'OSPF', 'SDN', 'TCP/IP', 'Socket', '光缆', '链路预算', '交换原理', '移动通信', '物联网',
    '5G', 'LoRa', 'ZigBee', '蓝牙', 'RFID', '微机接口', '射频', '天线',
    /* 工具与工程 */
    'Android', 'Android Studio', 'Qt', 'MFC', 'Unity', 'Unreal', 'SolidWorks', 'AutoCAD',
    'ANSYS', 'Multisim', 'Proteus', 'Office', 'Visio', 'Excel', 'PPT', 'Word', 'Xmind',
    'Photoshop', 'Figma', 'Axure', 'Postman', 'JMeter', 'Selenium', 'Pytest', 'JUnit',
    'Spark', 'Hadoop', 'Hive', 'Flink', 'ETL', '数据仓库', '数据分析', '数据可视化',
    'Tableau', 'Power BI', '爬虫', 'Scrapy',
    /* 通用科研与工程能力 */
    'CET-6', 'CET-4', 'CET6', 'CET4', '英语六级', '英语四级', '英文文献阅读', '文献检索',
    '论文写作', '专利申请', '需求分析', '系统设计', '架构设计', '接口设计', '技术文档',
    '单元测试', '敏捷开发', 'Scrum', '项目管理', '版本控制'
  ];

  /* 次要技能：偏软技能 / 描述性短语，页面上用灰色标签 */
  var AUX = [
    '学习能力强', '独立学习', '问题拆解', '团队协作', '沟通能力', '跨职能协作', '抗压能力',
    '责任心', '执行力', '自驱力', '时间管理', '技术分享', '技术培训', '文档撰写',
    '工程文档', '方案设计', '需求调研', '用户沟通', '跨学科整合', '快速学习',
    '英语能力', '读写能力', '科研能力', '创新能力', '逻辑思维', '数据分析能力',
    '系统建模', '软硬件联调', '工程实现', '测试联调', '结果整理', '可视化分析',
    '嵌入式开发', '客户端开发', '桌面应用开发', 'Web 开发', '前后端开发', '全流程开发',
    '算法实现', '外场试验', '数据采集', '数据标注', '数据集构建', '仿真实验'
  ];

  /* 用于切分中文顿号串的通用分隔符 */
  var SPLIT_RE = /[、,，;；\/\|\uFF5C]+/;

  /* 带"可完成/具备/熟悉"等描述前缀的句子，抽出来的短语更长，做一次清洗 */
  var DESC_PREFIX_RE = /^(可|能|具备|熟悉|熟练|掌握|了解|精通|擅长|具有|会|有|可完成|能够|可独立|可承担)+/;

  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\u00A0/g, ' ')
      .replace(/[（(]\s*[)）]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var _cache = null;
  var _cacheKey = '';

  /** 返回按长度倒序的 [词, 等级] 列表，保证 "Spring Boot" 先于 "Spring" 命中 */
  function entries() {
    var key = MAIN.length + ':' + AUX.length;
    if (_cache && _cacheKey === key) return _cache;
    var list = [];
    MAIN.forEach(function (w) { list.push([w, 'main']); });
    AUX.forEach(function (w) { list.push([w, 'aux']); });
    list.sort(function (a, b) { return b[0].length - a[0].length; });
    _cache = list;
    _cacheKey = key;
    return list;
  }

  function isKnown(term) {
    var t = normalize(term).toLowerCase();
    if (!t) return null;
    for (var i = 0; i < entries().length; i++) {
      if (entries()[i][0].toLowerCase() === t) return entries()[i][1];
    }
    return null;
  }

  /** 在一个短语里找出所有已知技能词（长词优先，命中后从串里抠掉避免重复） */
  function extractFromPhrase(phrase) {
    var text = normalize(phrase);
    var found = [];
    if (!text) return found;

    /* 整串本身就是技能词 */
    var exact = isKnown(text);
    if (exact) return [{ text: text, level: exact }];

    var rest = text;
    entries().forEach(function (pair) {
      var word = pair[0];
      if (!word) return;
      var idx = rest.toLowerCase().indexOf(word.toLowerCase());
      if (idx === -1) return;
      /* 单个拉丁字母（C / R）要求前后是边界，避免命中单词内部 */
      if (/^[A-Za-z]$/.test(word)) {
        var before = rest[idx - 1] || '';
        var after = rest[idx + word.length] || '';
        if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return;
      }
      found.push({ text: word, level: pair[1] });
      rest = rest.slice(0, idx) + ' '.repeat(word.length) + rest.slice(idx + word.length);
    });
    return found;
  }

  /**
   * 把一段技能描述切成标签数组
   * @param {string} text 形如 "C 语言、Java；可完成基础算法实现、Android 客户端开发"
   * @returns {Array<{text:string, level:'main'|'aux'}>}
   */
  function extractTags(text) {
    var out = [];
    var seen = Object.create(null);

    function push(tag) {
      var t = normalize(tag);
      if (!t || t.length > 24) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      var level = isKnown(t) || 'aux';
      out.push({ text: t, level: level });
    }

    String(text == null ? '' : text)
      .split(/[；;。\n]+/)          /* 先按分句切 */
      .forEach(function (clause) {
        clause.split(SPLIT_RE).forEach(function (piece) {
          var p = normalize(piece);
          if (!p) return;

          /* 先剥描述性前缀，让「可完成基础算法实现」露出真正的技能词 */
          var stripped = p.replace(DESC_PREFIX_RE, '').trim();
          var hits = extractFromPhrase(stripped);
          if (!hits.length) hits = extractFromPhrase(p);

          if (hits.length) {
            /* 命中技能词 → 一律输出词表里的规范写法，避免「遗传算法应用」这类尾巴 */
            hits.forEach(function (h) { push(h.text); });
          } else if (p.length <= 24) {
            push(p);
          }
        });
      });

    return out;
  }

  /** 判定单个词条的主次等级 */
  function classify(term) {
    return isKnown(term) || 'aux';
  }

  /** 从一整段自由文本里挑出所有技能词（用于自动生成「核心技能」） */
  function scanText(text) {
    var found = [];
    var seen = Object.create(null);
    var hay = normalize(text);
    if (!hay) return found;
    entries().forEach(function (pair) {
      var word = pair[0];
      var idx = hay.toLowerCase().indexOf(word.toLowerCase());
      if (idx === -1) return;
      if (/^[A-Za-z]$/.test(word)) {
        var before = hay[idx - 1] || '';
        var after = hay[idx + word.length] || '';
        if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return;
      }
      var key = word.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      found.push({ text: word, level: pair[1] });
    });
    return found;
  }

  var Skills = {
    MAIN: MAIN,
    AUX: AUX,
    extractTags: extractTags,
    extractFromPhrase: extractFromPhrase,
    classify: classify,
    isKnown: isKnown,
    scanText: scanText,
    normalize: normalize
  };

  global.ResumeSkills = Skills;
  if (typeof module !== 'undefined' && module.exports) module.exports = Skills;
})(typeof window !== 'undefined' ? window : globalThis);
