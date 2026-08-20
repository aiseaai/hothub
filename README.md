# 🔥 HotHub · 全网热榜聚合

一站式查看全网各平台热榜。左侧导航选择平台，中间展示榜单，支持多维度切换。

**🌐 线上地址：https://aiseaai.github.io/hothub/**

**榜单来源（均为各平台官方口径，不是我们自己排序）**：

| 分组 | 榜单 |
|---|---|
| 综合热点 | 微博（热搜/话题/社会/文娱）、百度、今日头条、腾讯新闻、微信24h热文 |
| 问答社区 | 知乎、V2EX、百度贴吧、豆瓣、虎扑、NGA |
| 视频娱乐 | **抖音 27 榜**（热点/总榜/娱乐/美食/体育/财经/科技/旅行/汽车/剧情/游戏/时尚/亲子/明星/才艺/三农/户外/公益/创意/随拍/二次元/校园/动植物/图文控/文化教育/泛生活…）、B站（日榜+全站排行·可按播放/点赞/投币/收藏/评论/分享切换）、快手、AcFun |
| 科技开发 | 36氪、IT之家、少数派、掘金、GitHub Trending（日/周/月） |
| 财经 | 雪球、东方财富股吧、华尔街见闻（日/资讯/周）、财联社、新浪财经、第一财经、英为财情、格隆汇、经济观察网、21财经、集思录、日经中文网 |
| 国际财经 | Yahoo Finance、CNBC、MarketWatch、Investing.com、FT中文网 |
| 国际视野 | Hacker News（Top/Best/New）、Reddit（Hot/Top/Controversial） |

## 工作原理

```
GitHub Actions（每小时自动运行）
   ↓ node scripts/fetch-boards.mjs
   ↓ 抓取 tophub.today / Bilibili API / Reddit / Hacker News / GitHub / RSSHub
   ↓ 生成 data/hotboards.json 并自动提交
GitHub Pages 静态托管
   ↓ 前端读取 JSON 渲染
你的浏览器
```

## 本地使用

```bash
npm install        # 无第三方依赖，仅为规范
npm run fetch      # 抓取数据，生成 data/hotboards.json
# 然后用任意静态服务器预览，例如：
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

## 部署到 GitHub Pages（保姆级教程）

> 需要：一个 GitHub 账号（免费）

### 第 1 步：创建仓库

1. 打开 https://github.com/new （需先登录）
2. Repository name 填：`hothub`
3. 选 **Public**（公开，GitHub Pages 免费托管需要）
4. 不要勾选任何初始化选项（README、.gitignore 都不要勾）
5. 点 **Create repository**

### 第 2 步：把代码推上去（二选一）

**方式 A：GitHub Desktop（推荐，图形化，零命令）**
1. 下载安装 https://desktop.github.com/
2. 打开后登录你的 GitHub 账号
3. File → Clone repository → 选你刚建的 `hothub` 仓库 → 选个本地存放位置 → Clone
4. 把你电脑上本项目（HotHub 文件夹）里的**所有文件**复制进刚克隆出来的 `hothub` 文件夹（覆盖/合并）
5. 回到 GitHub Desktop，左侧会显示变更，底部填一句说明（如"first commit"），点 **Commit to main**
6. 点右上角 **Push origin**，完成

**方式 B：命令行**
```bash
cd HotHub
git init
git add .
git commit -m "init hothub"
git branch -M main
git remote add origin https://github.com/你的用户名/hothub.git
git push -u origin main
```

### 第 3 步：开启 GitHub Pages

1. 打开 https://github.com/你的用户名/hothub/settings/pages
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/ (root)`，点 **Save**
4. 等 1~2 分钟，你的网址就是：
   `https://你的用户名.github.io/hothub/`

### 第 4 步：验证自动更新

1. 打开仓库的 **Actions** 标签页，能看到 `Fetch Hot Boards` 工作流
2. 第一次可以手动触发一次：Actions → 左侧 `Fetch Hot Boards` → 右侧 **Run workflow** → 绿色按钮
3. 之后每天每小时自动更新，无需任何操作

## 自定义

- 增删榜单：编辑 `scripts/fetch-boards.mjs` 中的 `BOARDS` 数组
- 调整刷新频率：修改 `.github/workflows/fetch.yml` 中的 cron 表达式
- tophub 节点 ID：在 tophub.today 打开任意榜单，URL 中 `/n/` 后面那串就是

## 说明与免责声明

- 数据来自各平台官方榜单的公开页面/接口，仅作个人学习与信息聚合用途
- 部分平台（如抖音细分榜）来自 tophub.today 的公开聚合页面
- **Reddit / NGA** 会屏蔽服务器机房 IP（返回 403），在 GitHub Actions 环境下可能长期显示"暂不可用"，属数据源限制，不影响其他榜单
- 个别榜单可能因数据源反爬或接口变动暂时不可用，页面会显示提示，下个周期自动恢复
