# 探迹关税：固定网址与 iPhone 使用

GitHub Pages 版本把查询页面、官方税则快照和查询逻辑一起发布。发布成功后，手机直接连接 GitHub 提供的网址，电脑关机也能使用。它不运行本地服务器，不需要保留临时网址或电脑上的隧道程序。

## 用 GitHub Actions 发布

1. 在自己的 GitHub 账户创建仓库，将本应用目录作为仓库根目录上传，包含 `.github/workflows/pages.yml`、`scripts/`、`templates/`、`data/`、`lib/`、`public/` 和 `vendor/` 等项目文件。
2. 打开仓库的 **Settings → Pages**，将 **Build and deployment → Source** 设为 **GitHub Actions**。
3. 在 **Actions** 中运行项目提供的 Pages 发布流程。流程会构建静态版并上传发布，不需要电脑持续开机。
4. 等流程完成，从 **Settings → Pages** 或发布流程的部署结果打开正式网址。以 GitHub 显示的实际发布网址为准。

上传前请排除 `runtime/`、`qa/`、本地运行记录、临时二维码和其他私人文件。仓库内容以本应用项目文件为限；不要上传工作区中的其他项目或个人资料。

完整官方快照以 `data/hts-full.json.gz` 入库。Actions 在测试前运行 `node scripts/prepare-data.mjs`，按需恢复原始 JSON 并生成离线数据；直接运行静态构建也会准备数据。已有原始 JSON 不会被旧压缩快照覆盖。`data/hts-full.json`、`public/data/hts-offline.json` 与 `dist/` 为本地生成文件，不上传仓库。首次克隆后若需要本地运行，可使用 `npm start` 或 `npm test`，两者都会先完成数据准备。

## iPhone 添加到桌面

在 Safari 打开正式网址，点「分享」→「添加到主屏幕」。如果出现「作为网页 App 打开」，保持开启，再点「添加」。从桌面图标首次打开时保持联网，等页面出现「离线基础税则已保存」。之后保存的查询功能可以离线使用；清除网站数据后需要重新联网保存。

## 数据日期与更新

页面显示税则版本和数据获取日期。查询使用发布时附带的官方快照，**并非实时税率**。基础税率不等于最终综合税负，加征税候选、反倾销、反补贴及认证要求仍需按官方规定核验。

本部署流程没有默认定时更新。在 GitHub Actions 中手动启动发布流程时，「发布前下载并校验官方最新税则」默认开启；下载和校验成功后，新快照会随网站发布，但不会自动写回仓库。取消该选项，或通过推送提交触发流程时，发布使用仓库中的快照。重新运行旧的推送流程也不会自动下载最新税则。

维护者可以先在本地运行以下数据更新命令，成功校验后再提交相应文件：

```sh
node scripts/update-data.mjs
```

若需要把本地新快照长期保存到仓库，应同步重新生成 `data/hts-full.json.gz`，并确认解压字节与新原始 JSON 完全一致；不要提交已忽略的生成 JSON。

## 构建路径

项目仓库通常发布在 `https://账户名.github.io/仓库名/`。例如仓库名为 `tanji-tariff`：

```sh
node scripts/build-cloud.mjs --base /tanji-tariff/ --out dist
```

对于账户主站仓库 `账户名.github.io`，或使用独立域名的根目录部署：

```sh
node scripts/build-cloud.mjs --base / --out dist
```

`--base` 必须与最终网址的路径一致；构建脚本会同步调整网页资源、图标、应用清单与离线保存的路径。`--out dist` 输出到应用目录下的 `dist/`，不指定时输出到同级 `tanji-tariff-cloud/`。静态托管平台应发布整个输出目录，保留隐藏的 `.nojekyll` 文件。

构建输出只有静态文件。可把 `dist/` 上传至支持 HTTPS 的其他静态托管服务，使用根路径时选择 `--base /`。它不会运行 `server.mjs`。

## 公开内容与密钥

如果使用公开仓库，应用代码和仓库中的数据对外可见；发布站点中的税则文件也可以被访问。请仅使用可公开的项目文件。

基础查询不需要填写关税 API 密钥。GitHub Actions 使用 GitHub 提供的发布身份和仓库权限，不需要将个人访问令牌写入代码。手机上的收藏与查询历史保存在该设备的浏览器中，应用没有上传收藏、账户资料或私人业务数据的接口。
