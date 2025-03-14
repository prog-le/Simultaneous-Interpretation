import asyncio
import dashscope
import threading
import time
import json
import os

# 根据测试结果，正确导入相关类
try:
    from dashscope.audio.asr import TranslationRecognizerRealtime, TranslationRecognizerCallback
    from dashscope.audio.asr import TranscriptionResult, TranslationResult
    print("成功导入 Gummy API 相关类")
except ImportError as e:
    print(f"导入 Gummy API 相关类失败: {e}")
    raise ImportError("无法导入必要的 dashscope 类，请确保安装了最新版本的 dashscope 库")

# 全局变量用于麦克风
mic = None
stream = None

class TranslatorCallback(TranslationRecognizerCallback):
    def __init__(self, websocket=None):
        self.websocket = websocket
        
    def on_open(self) -> None:
        global mic, stream
        print("连接已打开")
        
        # 如果使用麦克风，则初始化麦克风
        if hasattr(self, 'use_microphone') and self.use_microphone:
            try:
                import pyaudio
                mic = pyaudio.PyAudio()
                stream = mic.open(
                    format=pyaudio.paInt16,
                    channels=1,
                    rate=16000,
                    input=True
                )
                print("麦克风已初始化")
            except Exception as e:
                print(f"初始化麦克风失败: {e}")
    
    def on_close(self) -> None:
        global mic, stream
        print("连接已关闭")
        
        # 关闭麦克风
        if stream:
            stream.stop_stream()
            stream.close()
        if mic:
            mic.terminate()
        stream = None
        mic = None
    
    def on_error(self, message) -> None:
        print(f"错误: {message}")
        # 发送错误消息到 WebSocket
        if self.websocket:
            error_msg = {"status": "error", "message": message}
            self._send_result_to_websocket(error_msg)
    
    def on_complete(self) -> None:
        print("处理完成")
        # 发送完成消息到 WebSocket
        if self.websocket:
            complete_msg = {"status": "complete"}
            self._send_result_to_websocket(complete_msg)
    
    def on_event(
        self,
        request_id,
        transcription_result: TranscriptionResult,
        translation_result: TranslationResult,
        usage,
    ) -> None:
        print(f"收到事件: {request_id}")
        result = {
            "request_id": request_id,
            "transcription": None,
            "translations": {},
            "is_sentence_end": False
        }
        
        if transcription_result is not None:
            result["transcription"] = {
                "text": transcription_result.text,
                "sentence_id": transcription_result.sentence_id,
                "is_sentence_end": transcription_result.is_sentence_end
            }
            if transcription_result.is_sentence_end:
                result["is_sentence_end"] = True
            print(f"识别结果: {transcription_result.text}")
            
            # 处理 stash 数据（如果有）
            if hasattr(transcription_result, 'stash') and transcription_result.stash is not None:
                result["transcription"]["stash"] = {
                    "text": transcription_result.stash.text
                }
                print(f"识别缓存: {transcription_result.stash.text}")
                
        if translation_result is not None:
            for lang in translation_result.get_language_list():
                trans = translation_result.get_translation(lang)
                result["translations"][lang] = {
                    "text": trans.text,
                    "sentence_id": trans.sentence_id,
                    "is_sentence_end": trans.is_sentence_end
                }
                if trans.is_sentence_end:
                    result["is_sentence_end"] = True
                print(f"翻译结果 ({lang}): {trans.text}")
                
                # 处理 stash 数据（如果有）
                if hasattr(trans, 'stash') and trans.stash is not None:
                    result["translations"][lang]["stash"] = {
                        "text": trans.stash.text
                    }
                    print(f"翻译缓存 ({lang}): {trans.stash.text}")
        
        self._send_result_to_websocket(result)
    
    def _send_result_to_websocket(self, result):
        # 发送结果到 WebSocket
        if self.websocket:
            try:
                asyncio.run(self.send_result(result))
            except RuntimeError:
                # 处理"事件循环已运行"错误
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(self.send_result(result))
                loop.close()
    
    async def send_result(self, result):
        if self.websocket:
            try:
                await self.websocket.send(json.dumps(result))
            except Exception as e:
                print(f"发送 WebSocket 消息失败: {e}")

class Translator:
    def __init__(self, api_key, websocket=None):
        dashscope.api_key = api_key
        self.callback = TranslatorCallback(websocket)
        self.translator = None
        self.is_running = False
        self.is_paused = False
        self.audio_thread = None
        self.use_microphone = False  # 默认禁用麦克风
        
        # 用于同步调用的翻译器实例
        self.sync_translator = None

    def start(self, source_language, target_languages, format="pcm", sample_rate=16000):
        """启动翻译服务"""
        try:
            print(f"启动翻译: 源语言={source_language}, 目标语言={target_languages}")
            print("创建翻译器实例...")
            
            # 设置回调的麦克风使用标志
            self.callback.use_microphone = self.use_microphone
            
            # 创建翻译器实例
            self.translator = TranslationRecognizerRealtime(
                model="gummy-realtime-v1",
                format=format,
                sample_rate=sample_rate,
                source_language=source_language,
                transcription_enabled=True,
                translation_enabled=True,
                translation_target_languages=target_languages,
                callback=self.callback
            )
            
            print("启动翻译服务...")
            self.translator.start()
            self.is_running = True
            
            # 如果使用麦克风，启动麦克风线程
            if self.use_microphone:
                self._start_microphone_thread()
            
            return True
        except Exception as e:
            print(f"启动翻译服务失败: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _start_microphone_thread(self):
        """启动麦克风采集线程"""
        import threading
        
        def mic_thread():
            global stream
            print("开始从麦克风采集音频...")
            while self.is_running and not self.is_paused:
                if stream:
                    try:
                        data = stream.read(3200, exception_on_overflow=False)
                        if self.translator:
                            self.translator.send_audio_frame(data)
                        time.sleep(0.05)  # 控制采样率
                    except Exception as e:
                        print(f"从麦克风读取数据失败: {e}")
                        break
                else:
                    print("麦克风流未初始化")
                    break
            print("麦克风采集线程结束")
        
        self.audio_thread = threading.Thread(target=mic_thread)
        self.audio_thread.daemon = True
        self.audio_thread.start()
    
    def pause(self):
        if not self.is_running or self.is_paused:
            return False
            
        self.is_paused = True
        return True
        
    def resume(self):
        if not self.is_running or not self.is_paused:
            return False
            
        self.is_paused = False
        
        # 如果使用麦克风，重新启动麦克风线程
        if self.use_microphone:
            self._start_microphone_thread()
            
        return True
        
    def stop(self):
        if not self.is_running:
            return False
            
        self.is_running = False
        if self.translator:
            self.translator.stop()
            self.translator = None
            
        return True

    def process_audio_file(self, file_path, chunk_size=3200):
        """处理音频文件并发送到翻译服务"""
        if not self.is_running:
            print("翻译服务未启动")
            return False
        
        if not os.path.exists(file_path):
            print(f"文件不存在: {file_path}")
            return False
        
        try:
            # 检查文件大小
            file_size = os.path.getsize(file_path)
            if file_size == 0:
                print(f"文件为空: {file_path}")
                return False
            
            print(f"开始处理音频文件: {file_path}, 大小: {file_size} 字节")
            
            # 检查文件格式
            import wave
            try:
                with wave.open(file_path, 'rb') as wf:
                    # 获取音频文件信息
                    channels = wf.getnchannels()
                    sample_width = wf.getsampwidth()
                    frame_rate = wf.getframerate()
                    frames = wf.getnframes()
                    
                    print(f"音频信息: 通道数={channels}, 采样宽度={sample_width}, 采样率={frame_rate}, 帧数={frames}")
                    
                    # 如果不是16kHz单声道16位PCM，可能需要转换
                    if channels != 1 or frame_rate != 16000 or sample_width != 2:
                        print(f"警告: 音频格式不是标准的16kHz单声道16位PCM，可能需要转换")
            except:
                # 不是WAV文件，继续尝试处理
                print(f"警告: 不是标准WAV文件，将尝试直接处理")
            
            with open(file_path, 'rb') as f:
                # 发送一些空白音频帧以初始化流
                blank_audio = b'\x00' * 6400
                if self.translator:
                    self.translator.send_audio_frame(blank_audio)
                    time.sleep(0.1)
                
                # 读取并发送实际音频数据
                sent_bytes = 0
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    if self.translator and not self.is_paused:
                        self.translator.send_audio_frame(chunk)
                        sent_bytes += len(chunk)
                    time.sleep(0.05)  # 控制发送速率
                
                print(f"音频文件处理完成: {file_path}, 已发送 {sent_bytes} 字节")
                
                # 发送一些空白音频帧以结束流
                if self.translator:
                    self.translator.send_audio_frame(blank_audio)
                    time.sleep(0.1)
                
                return True
        except Exception as e:
            print(f"处理音频文件失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def set_use_microphone(self, use_mic):
        """设置是否使用麦克风"""
        self.use_microphone = use_mic
        return True

    def call_sync(self, file_path, source_language, target_languages, format="wav", sample_rate=16000):
        """同步调用翻译服务，直接返回结果"""
        try:
            print(f"同步调用翻译: 源语言={source_language}, 目标语言={target_languages}, 文件={file_path}")
            
            # 创建用于同步调用的翻译器实例
            sync_translator = TranslationRecognizerRealtime(
                model="gummy-realtime-v1",
                format=format,
                sample_rate=sample_rate,
                source_language=source_language,
                transcription_enabled=True,
                translation_enabled=True,
                translation_target_languages=target_languages,
                callback=None  # 同步调用不需要回调
            )
            
            # 调用同步方法
            result = sync_translator.call(file_path)
            
            # 处理结果
            if not hasattr(result, 'error_message') or not result.error_message:
                print(f"同步调用成功，请求ID: {result.request_id}")
                
                # 处理转录结果
                transcriptions = []
                if hasattr(result, 'transcription_result_list') and result.transcription_result_list:
                    for transcription_result in result.transcription_result_list:
                        if transcription_result:
                            transcriptions.append(transcription_result.text)
                            print(f"识别结果: {transcription_result.text}")
                
                # 处理翻译结果
                translations = {}
                if hasattr(result, 'translation_result_list') and result.translation_result_list:
                    for translation_result in result.translation_result_list:
                        if translation_result:
                            for lang in translation_result.get_language_list():
                                trans = translation_result.get_translation(lang)
                                if trans:
                                    if lang not in translations:
                                        translations[lang] = []
                                    translations[lang].append(trans.text)
                                    print(f"翻译结果 ({lang}): {trans.text}")
                
                return {
                    "success": True,
                    "request_id": result.request_id,
                    "transcriptions": transcriptions,
                    "translations": translations
                }
            else:
                error_message = result.error_message if hasattr(result, 'error_message') else "未知错误"
                print(f"同步调用失败: {error_message}")
                return {
                    "success": False,
                    "error": error_message
                }
        except Exception as e:
            print(f"同步调用翻译服务失败: {e}")
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "error": str(e)
            } 