# 实时语音翻译系统

这是一个基于通义实验室Gummy语音翻译大模型API的实时语音翻译系统，支持多种语言之间的实时翻译。系统提供了两种翻译模式：实时流式翻译和同步文件翻译。

## 功能特点

- **实时流式翻译**：支持麦克风输入的实时语音翻译
- **文件翻译**：支持上传音频文件进行翻译
- **同步翻译**：支持一次性处理整个音频文件
- **多语言支持**：支持中文、英语、日语、韩语等多种语言
- **实时显示**：实时显示识别和翻译结果
- **暂停/恢复**：支持暂停和恢复翻译过程
- **导出结果**：支持导出翻译结果为文本文件
- **大文件支持**：支持上传最大 2GB 的音频文件
- **分块上传**：大文件自动分块上传，提高稳定性

## 系统要求

- Python 3.7+
- 阿里云 DashScope API Key
- 现代浏览器（Chrome、Firefox、Edge 等）

## 安装

1. 克隆仓库
```bash
git clone https://github.com/prog-le/Simultaneous-Interpretation.git
cd Simultaneous-Interpretation
```
2. 安装依赖
```bash
pip install -r requirements.txt
```
3. 创建上传目录

## 使用方法

1. 启动应用

```bash
python app.py
```

2. 在浏览器中访问 `http://localhost:5000`

3. 设置 API Key（阿里云 DashScope API Key）

4. 选择源语言和目标语言

5. 选择输入方式（麦克风或文件）

6. 开始翻译

## 配置

系统配置可以在 `config.py` 文件中修改：

```python
class Config:
    # 支持的语言
    SUPPORTED_LANGUAGES = {
        "zh": "中文",
        "en": "英文",
        "ja": "日语",
        "yue": "粤语",
        "ko": "韩语"
    }
    
    # 支持的翻译方向
    SUPPORTED_TRANSLATIONS = {
        "zh": ["en", "ja", "ko"],
        "en": ["zh", "ja", "ko"],
        "ja": ["zh", "en"],
        # 更多翻译方向...
    }
```

## 项目结构

```
Simultaneous-Interpretation/
├── app.py                  # Flask 应用主文件
├── translator.py           # 翻译服务核心实现
├── config.py               # 配置文件
├── check_dashscope.py      # DashScope API 检查工具
├── requirements.txt        # 依赖列表
├── uploads/                # 上传文件临时目录
├── static/                 # 静态资源
│   ├── css/                # CSS 样式文件
│   │   ├── bootstrap.min.css
│   │   ├── bootstrap-icons.css
│   │   ├── style.css
│   │   └── fonts/          # 字体文件
│   └── js/                 # JavaScript 文件
│       ├── app.js          # 主要 JS 逻辑
│       ├── bootstrap.bundle.min.js
│       └── chunk-upload.js # 分块上传实现
└── templates/              # HTML 模板
    └── index.html          # 主页面
```

## API 接口

系统提供以下 API 接口：

- `/api/languages` - 获取支持的语言列表
- `/api/start_translation` - 启动翻译会话
- `/api/stop_translation` - 停止翻译会话
- `/api/pause_translation` - 暂停翻译
- `/api/resume_translation` - 恢复翻译
- `/api/upload_audio` - 上传音频文件
- `/api/translate_file_sync` - 同步翻译文件
- `/api/upload_chunk` - 分块上传（大文件）
- `/api/complete_upload` - 完成分块上传

## 技术栈

- **后端**：Flask, Python, WebSockets
- **前端**：HTML, CSS, JavaScript, Bootstrap 5
- **API**：阿里云 DashScope Gummy API

## 许可证

MIT

## 贡献

欢迎提交 Pull Request 或创建 Issue 来改进这个项目。

## 联系方式

如有问题，请通过 GitHub Issues 联系我们。

## 致谢

- 感谢阿里云提供的 DashScope API
- 感谢 Bootstrap 提供的 UI 框架
- 感谢所有开源贡献者

