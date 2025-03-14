import dashscope
import inspect

# 打印版本
print(f"DashScope 版本: {dashscope.__version__}")

# 打印模块结构
print("\n可用模块:")
for name in dir(dashscope):
    if not name.startswith("_"):
        print(f"- {name}")

# 检查 audio 模块
if hasattr(dashscope, 'audio'):
    print("\naudio 模块结构:")
    for name in dir(dashscope.audio):
        if not name.startswith("_"):
            print(f"- {name}") 