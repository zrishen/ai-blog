"""admin 域 service 子包：兑换码管理 / 用户管理 / 用量统计（admin 后台用）。

生成 / 激活兑换码在 services.accounts.subscription（create_codes / redeem）；本子包补 admin 管理所需。
"""

from .codes_service import (  # noqa: F401
    list_codes,
    revoke_code,
)
from .usage_service import (  # noqa: F401
    get_overview,
    get_user_weekly_usage,
)
from .users_service import (  # noqa: F401
    grant_subscription,
    list_users,
    set_admin,
)
