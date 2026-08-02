# Docker 部署

本目录集中保存容器镜像和网关配置；根目录 `compose.yaml` 是唯一编排入口。部署保持前后端同源，不修改业务接口：Nginx 托管 React 构建产物并把 `/api` 转发给单实例 FastAPI，`backend/data` 继续作为全部运行数据的事实目录。

## 结构

```text
compose.yaml
deploy/docker/
├── backend.Dockerfile
├── frontend.Dockerfile
├── nginx.conf
├── compose.env.example
└── README.md

backend/data/               # 宿主机持久数据，不进入镜像
```

后端固定运行一个 Uvicorn worker。PostgreSQL 与 FalkorDB 使用 Compose 命名卷，Markdown 和上传文件保存在 `backend/data`。

不要让本地开发后端和 Docker 后端同时读写同一个 `backend/data`，以免内容文件发生写入竞争。

## 首次启动

1. 准备后端环境变量：

   ```bash
   cp backend/.env.example backend/.env
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   python -c "import secrets; print(secrets.token_urlsafe(24))"
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   把三个生成值依次写入 `backend/.env` 的 `JWT_SECRET`、`REGISTRATION_INVITE_CODE`、`LLM_SETTINGS_ENCRYPTION_KEY`。加密主密钥丢失后已保存的用户 LLM Key 无法恢复，必须随数据备份并独立安全保管。生产域名启用 HTTPS 后设置 `COOKIE_SECURE=true`；纯 HTTP 联调期间保持 `false`。

2. 准备持久目录。镜像内应用用户 UID/GID 为 `10001`：

   ```bash
   mkdir -p backend/data
   sudo chown -R 10001:10001 backend/data
   ```

3. 可选：覆盖 Compose 端口或构建版本：

   ```bash
   cp deploy/docker/compose.env.example .env
   ```

4. 校验并启动：

   ```bash
   docker compose config
   docker compose build
   docker compose up -d
   docker compose ps
   curl http://127.0.0.1/health
   ```

服务默认只对外暴露 Nginx 的 `80` 端口，后端 `8000` 仅在 Compose 内部网络可见。

## 腾讯云单机建议

- 安全组只开放 SSH、HTTP 和 HTTPS；不要开放后端 `8000`。
- 首次测试可直接使用 `APP_PORT=80`。绑定域名后，推荐由腾讯云负载均衡、CDN/WAF 或宿主机 Caddy 终止 TLS。
- 如果宿主机反向代理负责 HTTPS，把根目录 `.env` 改为：

  ```env
  APP_BIND_ADDRESS=127.0.0.1
  APP_PORT=8080
  ```

  外层代理转发到 `127.0.0.1:8080`；同时在 `backend/.env` 设置 `COOKIE_SECURE=true`。
- `backend/data` 必须位于有持久化和备份策略的磁盘，不能存入容器临时层。

## 安全边界

后端镜像为了保持现有能力，包含 Node/npm 与 uv/uvx，用户配置的 `stdio` MCP 命令会在后端容器内执行，并能读写挂载的 `/app/data`。公开注册上线前必须禁用 `stdio` MCP，或把它限制为管理员可用的命令白名单；容器隔离不能代替这项权限控制。

## 更新与观察

```bash
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=200 backend
docker compose logs --tail=200 frontend
```

Compose 为两个服务配置了健康检查、自动重启和日志轮转。后端健康检查为 `/health`；包含数据库、上传目录和向量库状态的诊断接口为 `/api/v1/status`。

## 备份与恢复

备份 `backend/data` 前先停止后端写入；PostgreSQL 与 FalkorDB 命名卷需使用各自的数据库备份流程：

```bash
docker compose stop backend
tar -C backend -czf /安全备份目录/ai-blog-data-$(date +%F-%H%M).tar.gz data
docker compose start backend
```

恢复前先停止服务，把现有 `backend/data` 另行保留，再解压目标备份；不要直接覆盖一个正在运行的数据库。至少保留一份异机或对象存储备份，并定期验证能够恢复。

## 常见问题

- `backend` 启动失败：先检查 `backend/.env` 是否存在、`JWT_SECRET` 与 `LLM_SETTINGS_ENCRYPTION_KEY` 是否有效，以及 `backend/data` 权限。
- 前端显示 502：运行 `docker compose ps` 和 `docker compose logs backend`，确认后端健康检查通过。
- AI 流式输出停顿：确认外层 CDN/代理也关闭 SSE 缓冲，读取超时应高于 600 秒。
- 登录后刷新失效：HTTPS 环境检查 `COOKIE_SECURE=true`；跨域部署还需单独配置 CORS 与 Cookie 策略，本编排默认同源。
