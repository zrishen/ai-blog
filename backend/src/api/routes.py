"""统一路由注册入口：各业务路由模块在此汇总挂载到 /api 下。"""

from fastapi import APIRouter

from src.api.chat import router as chat_router
from src.api.chat_attachments import router as chat_attachments_router
from src.api.conversations import router as conversations_router
from src.api.plugins import router as plugins_router
from src.api.status import router as status_router
from src.api.files import router as files_router
from src.api.blog import router as blog_router
from src.api.workspace import router as workspace_router
from src.api.preview import router as preview_router
from src.api.auth import router as auth_router
from src.api.public_chat import router as public_chat_router
from src.api.settings import router as settings_router
from src.api.trash import router as trash_router
from src.api.admin import router as admin_router
from src.api.admin_codes import router as admin_codes_router
from src.api.admin_usage import router as admin_usage_router
from src.api.admin_users import router as admin_users_router
from src.api.admin_plugins import router as admin_plugins_router
from src.api.subscription import router as subscription_router
from src.api.brain import router as brain_router

router = APIRouter()

router.include_router(status_router)

router.include_router(auth_router)
router.include_router(settings_router)

router.include_router(conversations_router)

router.include_router(chat_router)
router.include_router(chat_attachments_router)
router.include_router(public_chat_router)

router.include_router(files_router)

router.include_router(plugins_router)

router.include_router(blog_router)

router.include_router(workspace_router)

router.include_router(preview_router)

router.include_router(trash_router)

router.include_router(admin_router)
router.include_router(admin_codes_router)
router.include_router(admin_users_router)
router.include_router(admin_usage_router)
router.include_router(admin_plugins_router)

router.include_router(subscription_router)

router.include_router(brain_router)
