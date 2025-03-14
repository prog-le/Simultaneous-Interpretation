import os
import json
import asyncio
import websockets
import uuid
from flask import Flask, render_template, request, jsonify, session
from config import Config
from translator import Translator
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = os.urandom(24)

# 添加上传文件夹配置
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2GB

# 存储活跃的翻译会话
active_translators = {}
active_websockets = {}

# WebSocket 服务器
async def websocket_handler(websocket, path):
    # 从路径中提取会话ID
    session_id = path.split('/')[-1]
    print(f"WebSocket 连接: {session_id}")
    
    if session_id not in active_translators:
        await websocket.close(1008, "无效的会话ID")
        return
    
    # 存储 WebSocket 连接
    active_websockets[session_id] = websocket
    active_translators[session_id].callback.websocket = websocket
    
    try:
        # 发送连接成功消息
        await websocket.send(json.dumps({"status": "connected"}))
        
        # 保持连接直到客户端断开
        async for message in websocket:
            # 处理来自客户端的消息
            try:
                data = json.loads(message)
                print(f"收到客户端消息: {data}")
                
                # 处理暂停/恢复命令
                if data.get('command') == 'pause':
                    active_translators[session_id].pause()
                    await websocket.send(json.dumps({"status": "paused"}))
                elif data.get('command') == 'resume':
                    active_translators[session_id].resume()
                    await websocket.send(json.dumps({"status": "resumed"}))
                elif data.get('command') == 'stop':
                    active_translators[session_id].stop()
                    await websocket.send(json.dumps({"status": "stopped"}))
            except json.JSONDecodeError:
                print(f"无效的 JSON 消息: {message}")
    except websockets.exceptions.ConnectionClosed:
        print(f"WebSocket 连接关闭: {session_id}")
    finally:
        # 清理连接
        if session_id in active_websockets:
            del active_websockets[session_id]
        if session_id in active_translators:
            active_translators[session_id].callback.websocket = None

# 启动 WebSocket 服务器
def start_websocket_server():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    start_server = websockets.serve(websocket_handler, "0.0.0.0", 8765)
    loop.run_until_complete(start_server)
    print("WebSocket 服务器已启动在 ws://0.0.0.0:8765")
    loop.run_forever()

# 在单独的线程中启动 WebSocket 服务器
import threading
websocket_thread = threading.Thread(target=start_websocket_server, daemon=True)
websocket_thread.start()

@app.route('/')
def index():
    # 从配置中获取支持的语言列表
    languages = Config.SUPPORTED_LANGUAGES
    return render_template('index.html', languages=languages)

@app.route('/api/save_api_key', methods=['POST'])
def save_api_key():
    data = request.get_json()
    api_key = data.get('api_key', '')
    
    if not api_key:
        return jsonify({"success": False, "message": "API Key 不能为空"}), 400
    
    # 在会话中保存 API Key
    session['api_key'] = api_key
    
    return jsonify({"success": True})

@app.route('/api/start_translation', methods=['POST'])
def start_translation():
    try:
        data = request.get_json()
        if not data:
            print("错误: 请求中没有 JSON 数据")
            return jsonify({"success": False, "message": "请求中没有 JSON 数据"}), 400
            
        # 直接从请求中获取 API Key
        api_key = data.get('api_key', '')
        if not api_key:
            # 尝试从会话中获取
            api_key = session.get('api_key', '')
            
        if not api_key:
            print("错误: 未设置 API Key")
            return jsonify({"success": False, "message": "未设置 API Key"}), 400
            
        source_language = data.get('source_language', '')
        if not source_language:
            print("错误: 未指定源语言")
            return jsonify({"success": False, "message": "请指定源语言"}), 400
            
        target_languages = data.get('target_languages', [])
        if not target_languages:
            print("错误: 未指定目标语言")
            return jsonify({"success": False, "message": "请至少选择一种目标语言"}), 400
            
        use_microphone = data.get('use_microphone', False)
        
        print(f"开始翻译: 源语言={source_language}, 目标语言={target_languages}, 使用麦克风={use_microphone}")
        
        # 创建会话ID
        session_id = str(uuid.uuid4())
        
        # 创建翻译器实例
        translator = Translator(api_key)
        translator.set_use_microphone(use_microphone)
        
        # 存储翻译器实例
        active_translators[session_id] = translator
        
        # 启动翻译
        success = translator.start(source_language, target_languages)
        
        if success:
            # 获取主机名
            host = request.host.split(':')[0]
            # 如果是本地开发环境，使用 localhost
            if host == '0.0.0.0' or host == '127.0.0.1':
                host = 'localhost'
            
            ws_url = f"ws://{host}:8765/ws/{session_id}"
            print(f"生成 WebSocket URL: {ws_url}")
            return jsonify({
                "success": True, 
                "session_id": session_id,
                "websocket_url": ws_url
            })
        else:
            if session_id in active_translators:
                del active_translators[session_id]
            print("错误: 启动翻译失败")
            return jsonify({"success": False, "message": "启动翻译失败"}), 500
    except Exception as e:
        print(f"处理翻译请求时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"服务器错误: {str(e)}"}), 500

@app.route('/api/pause_translation', methods=['POST'])
def pause_translation():
    data = request.get_json()
    session_id = data.get('session_id', '')
    
    if not session_id or session_id not in active_translators:
        return jsonify({"success": False, "message": "无效的会话ID"}), 400
    
    success = active_translators[session_id].pause()
    return jsonify({"success": success})

@app.route('/api/resume_translation', methods=['POST'])
def resume_translation():
    data = request.get_json()
    session_id = data.get('session_id', '')
    
    if not session_id or session_id not in active_translators:
        return jsonify({"success": False, "message": "无效的会话ID"}), 400
    
    success = active_translators[session_id].resume()
    return jsonify({"success": success})

@app.route('/api/stop_translation', methods=['POST'])
def stop_translation():
    try:
        data = request.get_json()
        if not data:
            print("错误: 请求中没有 JSON 数据")
            return jsonify({"success": False, "message": "请求中没有 JSON 数据"}), 400
            
        session_id = data.get('session_id', '')
        
        if not session_id:
            print("错误: 未提供会话ID")
            return jsonify({"success": False, "message": "未提供会话ID"}), 400
        
        # 检查会话是否存在
        if session_id not in active_translators:
            print(f"警告: 会话ID不存在: {session_id}")
            # 如果会话不存在，也返回成功，因为最终目标是停止翻译
            return jsonify({"success": True, "message": "会话不存在，无需停止"})
        
        # 停止翻译
        translator = active_translators[session_id]
        success = translator.stop()
        
        # 清理资源
        if success:
            print(f"成功停止会话: {session_id}")
            del active_translators[session_id]
        else:
            print(f"停止会话失败: {session_id}")
        
        return jsonify({"success": success})
    except Exception as e:
        print(f"处理停止翻译请求时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"服务器错误: {str(e)}"}), 500

@app.route('/upload_audio', methods=['POST'])
def upload_audio():
    if 'audio_file' not in request.files:
        print("错误: 没有上传文件")
        return jsonify({"success": False, "message": "没有上传文件"}), 400
        
    file = request.files['audio_file']
    if file.filename == '':
        print("错误: 未选择文件")
        return jsonify({"success": False, "message": "未选择文件"}), 400
        
    session_id = request.form.get('session_id')
    if not session_id or session_id not in active_translators:
        print(f"错误: 无效的会话ID: {session_id}")
        return jsonify({"success": False, "message": "无效的会话ID"}), 400
    
    # 检查文件类型
    allowed_extensions = {'wav', 'mp3', 'ogg', 'flac', 'aac', 'pcm'}
    if '.' not in file.filename or file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
        print(f"错误: 不支持的文件类型: {file.filename}")
        return jsonify({"success": False, "message": "不支持的文件类型，请上传WAV、MP3、OGG、FLAC、AAC或PCM文件"}), 400
        
    # 保存文件
    filename = secure_filename(file.filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
    file.save(file_path)
    
    print(f"文件已保存: {file_path}")
    
    # 处理文件
    translator = active_translators[session_id]
    success = translator.process_audio_file(file_path)
    
    # 处理完成后删除文件
    try:
        os.remove(file_path)
        print(f"文件已删除: {file_path}")
    except Exception as e:
        print(f"删除文件失败: {file_path}, 错误: {e}")
        
    return jsonify({"success": success})

@app.route('/api/languages', methods=['GET'])
def get_languages():
    return jsonify({
        "success": True,
        "languages": Config.SUPPORTED_LANGUAGES
    })

@app.route('/api/test_session', methods=['GET'])
def test_session():
    api_key = session.get('api_key', '')
    return jsonify({
        "success": True,
        "has_api_key": bool(api_key),
        "api_key_masked": api_key[:4] + "****" if api_key else ""
    })

# 分块上传处理
@app.route('/api/upload_chunk', methods=['POST'])
def upload_chunk():
    if 'chunk' not in request.files:
        return jsonify({"success": False, "message": "没有上传分块"}), 400
        
    chunk = request.files['chunk']
    session_id = request.form.get('session_id')
    filename = request.form.get('filename')
    chunk_index = int(request.form.get('chunk_index', 0))
    total_chunks = int(request.form.get('total_chunks', 1))
    
    if not session_id or session_id not in active_translators:
        return jsonify({"success": False, "message": "无效的会话ID"}), 400
    
    # 创建临时目录存储分块
    chunks_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"chunks_{session_id}")
    if not os.path.exists(chunks_dir):
        os.makedirs(chunks_dir)
    
    # 保存当前分块
    chunk_path = os.path.join(chunks_dir, f"{filename}.part{chunk_index}")
    chunk.save(chunk_path)
    
    return jsonify({
        "success": True,
        "message": f"分块 {chunk_index + 1}/{total_chunks} 上传成功"
    })

# 完成分块上传
@app.route('/api/complete_upload', methods=['POST'])
def complete_upload():
    data = request.get_json()
    session_id = data.get('session_id')
    filename = data.get('filename')
    total_chunks = data.get('total_chunks')
    
    if not session_id or session_id not in active_translators:
        return jsonify({"success": False, "message": "无效的会话ID"}), 400
    
    # 分块目录
    chunks_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"chunks_{session_id}")
    if not os.path.exists(chunks_dir):
        return jsonify({"success": False, "message": "找不到上传的分块"}), 400
    
    # 合并文件路径
    merged_file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
    
    try:
        # 合并所有分块
        with open(merged_file_path, 'wb') as merged_file:
            for i in range(total_chunks):
                chunk_path = os.path.join(chunks_dir, f"{filename}.part{i}")
                if os.path.exists(chunk_path):
                    with open(chunk_path, 'rb') as chunk_file:
                        merged_file.write(chunk_file.read())
                else:
                    return jsonify({"success": False, "message": f"找不到分块 {i}"}), 400
        
        # 处理合并后的文件
        translator = active_translators[session_id]
        success = translator.process_audio_file(merged_file_path)
        
        # 清理临时文件
        import shutil
        shutil.rmtree(chunks_dir)
        os.remove(merged_file_path)
        
        return jsonify({"success": success})
    except Exception as e:
        print(f"合并文件失败: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"合并文件失败: {str(e)}"}), 500

@app.route('/api/translate_file_sync', methods=['POST'])
def translate_file_sync():
    if 'audio_file' not in request.files:
        print("错误: 没有上传文件")
        return jsonify({"success": False, "message": "没有上传文件"}), 400
        
    file = request.files['audio_file']
    if file.filename == '':
        print("错误: 未选择文件")
        return jsonify({"success": False, "message": "未选择文件"}), 400
    
    # 获取参数
    source_language = request.form.get('source_language', '')
    if not source_language:
        print("错误: 未指定源语言")
        return jsonify({"success": False, "message": "请指定源语言"}), 400
        
    target_languages = request.form.get('target_languages', '').split(',')
    if not target_languages or target_languages[0] == '':
        print("错误: 未指定目标语言")
        return jsonify({"success": False, "message": "请至少选择一种目标语言"}), 400
    
    # 获取 API Key
    api_key = request.form.get('api_key', '')
    if not api_key:
        # 尝试从会话中获取
        api_key = session.get('api_key', '')
        
    if not api_key:
        print("错误: 未设置 API Key")
        return jsonify({"success": False, "message": "未设置 API Key"}), 400
    
    # 保存文件
    filename = secure_filename(file.filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"sync_{filename}")
    file.save(file_path)
    
    print(f"文件已保存: {file_path}")
    
    try:
        # 创建翻译器实例
        translator = Translator(api_key)
        
        # 调用同步翻译方法
        result = translator.call_sync(
            file_path=file_path,
            source_language=source_language,
            target_languages=target_languages,
            format="wav",  # 根据文件类型调整
            sample_rate=16000
        )
        
        # 处理完成后删除文件
        try:
            os.remove(file_path)
            print(f"文件已删除: {file_path}")
        except Exception as e:
            print(f"删除文件失败: {file_path}, 错误: {e}")
        
        return jsonify(result)
    except Exception as e:
        print(f"同步翻译失败: {e}")
        import traceback
        traceback.print_exc()
        
        # 尝试删除文件
        try:
            os.remove(file_path)
        except:
            pass
            
        return jsonify({"success": False, "message": f"同步翻译失败: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False) 