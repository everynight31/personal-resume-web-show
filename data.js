/* =============================================================================
 *  data.js —— 简历唯一数据源
 * -----------------------------------------------------------------------------
 *  这里是一份【虚构示例简历】，人物、电话、邮箱、学校、公司、项目均为编造，
 *  仅用于演示页面结构与「粘贴识别」功能。请你把自己的内容替换进来。
 *
 *  这是整份简历的「内容层」。想改内容，改这里即可，页面会自动重绘。
 *  页面上通过「粘贴识别」改过的数据会存进 localStorage，优先级高于本文件；
 *  在识别面板里点「恢复默认数据」即可清掉本地覆盖，回到这个文件的内容。
 *
 *  字段约定（供解析器/大模型按行填写）：
 *    profile.name        姓名
 *    profile.avatar      头像路径（相对本文件的路径）
 *    profile.headline    一行身份说明，用 | 分隔
 *    profile.intent      报考/求职意向
 *    profile.contacts[]  {label, value, href, icon, note}
 *    sections[]          区块，sort: timeline | cards | tags | list
 *      timeline.items[]  {org, date, degree, location, bullets[], logo}
 *      cards.items[]     {org, date, title, location, logo, blocks:[{label,text}]}
 *      tags.groups[]     {title, items[{text, level}]}  level: main | aux
 *      list.items[]      {title, text}
 *
 *  可选字段：scores（成绩/评级条）。求职简历不需要，直接不要写这个字段；
 *  如果是考研复试简历，写成 { title, total:{label,value}, items:[{label,value}] } 即可自动显示。
 * ========================================================================== */

window.RESUME_DATA = {
  meta: {
    /* 数据版本号：每次修改本文件的内容，把这个数字 +1。
       页面会把「本地修改」连同当时的版本号一起存进 localStorage；
       一旦这里的数字变大，说明默认数据更新了，浏览器里的旧覆盖会被自动丢弃，
       避免出现「明明改了 data.js，网页上还是老内容」的情况。 */
    dataVersion: 4,

    title: '示例姓名 - 简历',
    footer: '© 示例姓名 · 示例简历（虚构内容）',
    footnote: 'Designed with a modern touch.',
    lang: 'zh-CN'
  },

  profile: {
    name: '示例姓名',
    avatar: 'assets/avatar.svg',
    headline: '示例大学 | 本科（计算机科学与技术） | 2025 届',
    intent: '求职意向：后端开发工程师 / 数据开发工程师',
    contacts: [
      { label: '电话', value: '13800000000', href: 'tel:13800000000', icon: 'phone' },
      { label: '邮箱', value: 'example@example.com', href: 'mailto:example@example.com', icon: 'mail' },
      { label: 'GitHub', value: 'github.com/example', href: 'https://github.com/example', icon: 'link' },
      { label: '基本信息', value: '男 | 23岁 | 中共党员', icon: 'user' }
    ]
  },

  /* 求职简历不写 scores 字段（这里原本是考研初试成绩，已按求职定位移除） */

  sections: [
    /* ---------------------------------------------------------------- 教育背景 */
    {
      id: 'education',
      title: '教育背景',
      anchor: 'education',
      sort: 'timeline',
      items: [
        {
          org: '示例大学',
          date: '2021.09 - 2025.06',
          degree: '本科 · 计算机科学与技术',
          location: '南京',
          logo: '',
          bullets: [
            '主修课程：数据结构与算法、操作系统、计算机网络、数据库系统原理、软件工程、分布式系统。',
            'GPA 3.7/4.0（专业前 10%）；连续三年获校级一等学业奖学金。'
          ]
        },
        {
          org: '示例大学',
          date: '2023.03 - 2023.07',
          degree: '交换学习 · 数据科学方向',
          location: '',
          logo: '',
          bullets: [
            '选修机器学习与数据可视化课程，完成结课项目并获评优秀。'
          ]
        }
      ]
    },

    /* ---------------------------------------------------------------- 实习经历 */
    {
      id: 'internship',
      title: '实习经历',
      anchor: 'internship',
      sort: 'cards',
      items: [
        {
          org: '某互联网科技有限公司',
          date: '2024.07 - 2024.12',
          title: '后端开发实习生',
          location: '杭州',
          logo: '',
          blocks: [
            {
              label: '技术实现',
              text: '参与订单中心重构，用 Java + Spring Boot 拆出三个独立服务，基于 Redis 做热点数据缓存与分布式锁，用 RocketMQ 解耦下单与库存扣减，把超卖问题从「靠定时对账」改成「消息幂等 + 预扣库存」。'
            },
            {
              label: '项目价值',
              text: '订单创建接口 P99 从 850ms 降到 120ms，压测下 QPS 从 800 提升到 5000；方案沉淀为团队内部《高并发下单实践》文档，被后续两个业务线复用。'
            },
            {
              label: '协作与流程',
              text: '主导把两个手动发布流程改成 GitLab CI + Docker 的一键部署，发布耗时从 40 分钟降到 8 分钟，线上回滚从「找运维」变成开发自助。'
            }
          ]
        }
      ]
    },

    /* ---------------------------------------------------------------- 项目经历 */
    {
      id: 'projects',
      title: '项目经历',
      anchor: 'projects',
      sort: 'cards',
      items: [
        {
          org: '分布式短链服务',
          date: '2024.03 - 2024.06',
          title: '个人项目 · 后端负责人',
          location: '',
          logo: '',
          blocks: [
            {
              label: '技术实现',
              text: '用 Go + Gin 实现发号器（Snowflake 变体）+ Base62 编码生成短链，MySQL 存映射关系，布隆过滤器 + 多级缓存挡穿透；用 302 跳转并异步写访问日志到 Kafka。'
            },
            {
              label: '项目价值',
              text: '单机压测 1.2 万 QPS、P99 28ms；缓存命中率 96%，把 MySQL 读流量压到原来的 4%。项目已开源，GitHub 200+ Star。'
            }
          ]
        },
        {
          org: '校园二手交易平台',
          date: '2023.09 - 2024.02',
          title: '课程项目 · 组长',
          location: '',
          logo: '',
          blocks: [
            {
              label: '技术实现',
              text: 'Vue 3 + Spring Boot + MySQL 的前后端分离系统，自己写 JWT 鉴权与 RBAC 权限模型，商品搜索用 Elasticsearch 做分词与拼音纠错，图片走对象存储 + CDN 回源。'
            },
            {
              label: '项目价值',
              text: '在校园内试运行三个月，累计注册 1200+ 用户、成交 300+ 单；作为课程设计获评「优秀项目」，并被下一届当作教学案例。'
            }
          ]
        }
      ]
    },

    /* ---------------------------------------------------------------- 相关技能 */
    {
      id: 'skills',
      title: '相关技能',
      anchor: 'skills',
      sort: 'tags',
      groups: [
        {
          title: '编程语言',
          items: [
            { text: 'Java', level: 'main' },
            { text: 'Go', level: 'main' },
            { text: 'Python', level: 'aux' },
            { text: 'SQL', level: 'main' },
            { text: 'JavaScript', level: 'aux' }
          ]
        },
        {
          title: '后端与框架',
          items: [
            { text: 'Spring Boot', level: 'main' },
            { text: 'Gin', level: 'main' },
            { text: '微服务', level: 'aux' },
            { text: 'RESTful', level: 'aux' },
            { text: 'gRPC', level: 'aux' }
          ]
        },
        {
          title: '数据与中间件',
          items: [
            { text: 'MySQL', level: 'main' },
            { text: 'Redis', level: 'main' },
            { text: 'Kafka', level: 'main' },
            { text: 'Elasticsearch', level: 'aux' },
            { text: 'MongoDB', level: 'aux' }
          ]
        },
        {
          title: '工程与运维',
          items: [
            { text: 'Docker', level: 'main' },
            { text: 'Kubernetes', level: 'main' },
            { text: 'Git', level: 'main' },
            { text: 'Linux', level: 'main' },
            { text: 'CI/CD', level: 'aux' }
          ]
        },
        {
          title: '英语能力',
          items: [
            { text: 'CET-6', level: 'main' },
            { text: '英文技术文档阅读', level: 'aux' }
          ]
        }
      ]
    },

    /* ---------------------------------------------------------------- 荣誉奖项 */
    {
      id: 'awards',
      title: '荣誉奖项',
      anchor: 'awards',
      sort: 'list',
      items: [
        {
          title: '学科竞赛',
          text: '中国大学生计算机设计大赛省赛一等奖（2024）、蓝桥杯 Java 组省赛二等奖（2023）、校级程序设计竞赛一等奖（2022）。'
        },
        {
          title: '奖学金',
          text: '校级一等学业奖学金三次（2022 / 2023 / 2024），校级三好学生（2023）。'
        },
        {
          title: '开源贡献',
          text: '为两个开源项目提交过 Bug Fix 与文档改进共 6 个 PR，均已合并。'
        }
      ]
    },

    /* ---------------------------------------------------------------- 自我评价 */
    {
      id: 'abilities',
      title: '自我评价',
      anchor: 'abilities',
      sort: 'list',
      items: [
        {
          title: '工程习惯',
          text: '习惯先写测试再改代码，提交粒度小、信息完整；做过的事会顺手补文档，避免同一坑踩第二次。'
        },
        {
          title: '学习与排查',
          text: '具备较强的独立排查能力，能顺着日志、监控与火焰图定位到具体代码行；新技术通常用一个小项目先跑通再引入生产。'
        },
        {
          title: '协作沟通',
          text: '在实习期间主动与产品、测试对齐边界条件，把需求歧义在开发前消化掉，减少返工。'
        }
      ]
    }
  ]
};
