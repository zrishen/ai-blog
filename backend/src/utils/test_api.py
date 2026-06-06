def main():
    import os
    from openai import OpenAI

    # 强烈建议：从环境变量读取 API Key（先执行：$env:OPENAI_API_KEY="你的真实Key"）
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("请先设置环境变量 OPENAI_API_KEY")

    # 创建客户端时指定 base_url 和 api_key
    client = OpenAI(
        api_key=api_key,
        base_url="https://dygpt.duoyioa.com/qianji/v1"
    )

    response = client.chat.completions.create(
        model="ds/deepseek-v4-pro",   # 请根据代理实际支持的模型名修改
        messages=[{"role": "user", "content": "你好，你叫什么"}],
        max_tokens=500
    )
    print(response.choices[0].message.content)

    # 方法 1: 使用 OpenAI SDK (推荐)
    # models = client.models.list()
    # print("=== SDK 获取的模型列表 ===")
    # for model in models.data:
    #     print(f"  - {model.id}")

if __name__ == "__main__":
    main()

    