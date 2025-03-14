import os
from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv()

class Config:
    # 阿里云 API 密钥
    API_KEY = os.getenv("ALIYUN_API_KEY", "")
    
    # 支持的语言列表
    SUPPORTED_LANGUAGES = {
        "zh": "中文",
        "en": "英文",
        "ja": "日语",
        "yue": "粤语",
        "ko": "韩语",
        "de": "德语",
        "fr": "法语",
        "ru": "俄语",
        "it": "意大利语",
        "es": "西班牙语"
    }
    
    # 支持的翻译方向
    SUPPORTED_TRANSLATIONS = {
        "zh": ["en", "ja", "ko"],
        "en": ["zh", "ja", "ko"],
        "ja": ["zh", "en"],
        "yue": ["zh", "en"],
        "ko": ["zh", "en"],
        "de": ["zh", "en"],
        "fr": ["zh", "en"],
        "ru": ["zh", "en"],
        "it": ["zh", "en"],
        "es": ["zh", "en"]
    }

# 添加测试代码
if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    api_key = os.getenv("ALIYUN_API_KEY", "")
    print(f"API Key: {'*' * (len(api_key) - 4) + api_key[-4:] if api_key else 'Not set'}") 