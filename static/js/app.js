document.addEventListener('DOMContentLoaded', function() {
    // 元素引用
    const apiKeyInput = document.getElementById('apiKey');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const sourceLanguageSelect = document.getElementById('sourceLanguage');
    const targetLanguagesDiv = document.getElementById('targetLanguages');
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    const stopBtn = document.getElementById('stopBtn');
    const exportBtn = document.getElementById('exportBtn');
    const transcriptionResult = document.getElementById('transcriptionResult');
    const translationResults = document.getElementById('translationResults');
    const statusBadge = document.getElementById('statusBadge');
    const systemLog = document.getElementById('systemLog');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const inputMicrophone = document.getElementById('inputMicrophone');
    const inputFile = document.getElementById('inputFile');
    const fileUploadArea = document.getElementById('fileUploadArea');
    const audioFileInput = document.getElementById('audioFile');
    const syncTranslateBtn = document.getElementById('syncTranslateBtn');
    
    // 翻译会话状态
    let sessionId = null;
    let websocket = null;
    let isPaused = false;
    let translationData = {
        transcription: [],
        translations: {}
    };
    
    // 日志函数
    function addLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString();
        
        logEntry.appendChild(timestamp);
        logEntry.appendChild(document.createTextNode(message));
        
        systemLog.appendChild(logEntry);
        systemLog.scrollTop = systemLog.scrollHeight;
    }
    
    // 清空日志
    clearLogBtn.addEventListener('click', function() {
        systemLog.innerHTML = '';
        addLog('日志已清空');
    });
    
    // 输入方式切换
    inputMicrophone.addEventListener('change', function() {
        if (this.checked) {
            fileUploadArea.classList.add('d-none');
            addLog('已选择麦克风输入模式');
        }
    });
    
    inputFile.addEventListener('change', function() {
        if (this.checked) {
            fileUploadArea.classList.remove('d-none');
            addLog('已选择文件输入模式');
        }
    });
    
    // 保存 API Key
    saveApiKeyBtn.addEventListener('click', function() {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            addLog('API Key 不能为空', 'error');
            return;
        }
        
        // 保存到 localStorage
        localStorage.setItem('api_key', apiKey);
        
        // 同时发送到服务器
        fetch('/api/save_api_key', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ api_key: apiKey })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                addLog('API Key 已保存', 'success');
                apiKeyInput.type = 'password'; // 隐藏 API Key
            } else {
                addLog(`保存 API Key 失败: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            addLog(`保存 API Key 出错: ${error}`, 'error');
        });
    });
    
    // 开始翻译
    startBtn.addEventListener('click', function() {
        const sourceLanguage = sourceLanguageSelect.value;
        if (!sourceLanguage) {
            addLog('请选择源语言', 'error');
            return;
        }
        
        // 获取选中的目标语言
        const targetLanguages = [];
        document.querySelectorAll('#targetLanguages input[type="checkbox"]:checked').forEach(checkbox => {
            targetLanguages.push(checkbox.value);
        });
        
        if (targetLanguages.length === 0) {
            addLog('请至少选择一种目标语言', 'error');
            return;
        }
        
        // 获取输入方式
        const useMicrophone = document.getElementById('inputMicrophone').checked;
        
        // 禁用开始按钮，防止重复点击
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> 正在启动...';
        
        // 从 localStorage 获取 API Key
        const apiKey = localStorage.getItem('api_key');
        if (!apiKey) {
            addLog('请先设置 API Key', 'error');
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="bi bi-play-fill"></i> 开始翻译';
            return;
        }
        
        // 发送请求，包含 API Key
        fetch('/api/start_translation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: apiKey,  // 直接在请求中包含 API Key
                source_language: sourceLanguage,
                target_languages: targetLanguages,
                use_microphone: useMicrophone
            })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.message || '启动翻译失败');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                addLog('翻译已启动', 'success');
                
                // 保存会话ID
                sessionId = data.session_id;
                
                // 更新UI状态
                startBtn.disabled = true;
                pauseBtn.disabled = false;
                stopBtn.disabled = false;
                exportBtn.disabled = false;
                statusBadge.textContent = '翻译中';
                statusBadge.className = 'badge bg-success';
                
                if (useMicrophone) {
                    statusBadge.classList.add('recording');
                }
                
                // 连接WebSocket
                connectWebSocket(data.websocket_url);
                
                // 如果是文件输入模式，处理文件上传
                if (!useMicrophone && document.getElementById('inputFile').checked) {
                    const audioFile = document.getElementById('audioFile').files[0];
                    if (audioFile) {
                        uploadAudioFile(audioFile, data.session_id);
                    } else {
                        addLog('请选择音频文件', 'warning');
                    }
                }
            } else {
                addLog(`启动翻译失败: ${data.message}`, 'error');
                startBtn.disabled = false;
                startBtn.innerHTML = '<i class="bi bi-play-fill"></i> 开始翻译';
            }
        })
        .catch(error => {
            addLog(`启动翻译出错: ${error.message}`, 'error');
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="bi bi-play-fill"></i> 开始翻译';
        });
    });
    
    // 文件上传处理
    function uploadAudioFile(file, sessionId) {
        if (!file) {
            addLog('没有选择文件', 'error');
            return;
        }
        
        addLog(`准备上传文件: ${file.name}`, 'info');
        
        // 检查文件类型
        const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mpeg'];
        if (!allowedTypes.includes(file.type) && !file.name.endsWith('.pcm')) {
            addLog(`不支持的文件类型: ${file.type}`, 'error');
            return;
        }
        
        // 检查文件大小 (修改为2GB)
        const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
        if (file.size > maxSize) {
            addLog('文件过大，请上传小于2GB的文件', 'error');
            return;
        }
        
        // 显示文件大小信息
        const fileSizeDisplay = file.size > 1024 * 1024 
            ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` 
            : `${(file.size / 1024).toFixed(2)} KB`;
        addLog(`文件大小: ${fileSizeDisplay}`, 'info');
        
        const formData = new FormData();
        formData.append('audio_file', file);
        formData.append('session_id', sessionId);
        
        addLog('开始上传文件...', 'info');
        
        // 添加上传进度显示
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload_audio', true);
        
        // 进度监听
        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                addLog(`上传进度: ${percentComplete.toFixed(2)}%`, 'info');
                
                // 可以在这里更新进度条UI
            }
        };
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    addLog('文件上传并处理成功', 'success');
                } else {
                    addLog(`文件处理失败: ${response.message || '未知错误'}`, 'error');
                }
            } else {
                addLog(`上传失败，服务器返回状态码: ${xhr.status}`, 'error');
            }
        };
        
        xhr.onerror = function() {
            addLog('上传过程中发生网络错误', 'error');
        };
        
        xhr.send(formData);
    }
    
    // 暂停翻译
    pauseBtn.addEventListener('click', function() {
        if (!sessionId) {
            addLog('没有活跃的翻译会话', 'error');
            return;
        }
        
        if (isPaused) {
            addLog('翻译已经处于暂停状态', 'warning');
            return;
        }
        
        fetch('/api/pause_translation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ session_id: sessionId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                isPaused = true;
                addLog('翻译已暂停', 'info');
                
                // 更新 UI
                pauseBtn.disabled = true;
                resumeBtn.disabled = false;
                
                statusBadge.textContent = '已暂停';
                statusBadge.className = 'badge bg-warning';
                statusBadge.classList.remove('recording');
                
                // 通知 WebSocket
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(JSON.stringify({ command: 'pause' }));
                }
            } else {
                addLog('暂停翻译失败', 'error');
            }
        })
        .catch(error => {
            addLog(`暂停翻译出错: ${error}`, 'error');
        });
    });
    
    // 恢复翻译
    resumeBtn.addEventListener('click', function() {
        if (!sessionId) {
            addLog('没有活跃的翻译会话', 'error');
            return;
        }
        
        if (!isPaused) {
            addLog('翻译未处于暂停状态', 'warning');
            return;
        }
        
        fetch('/api/resume_translation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ session_id: sessionId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                isPaused = false;
                addLog('翻译已恢复', 'info');
                
                // 更新 UI
                pauseBtn.disabled = false;
                resumeBtn.disabled = true;
                
                statusBadge.textContent = '翻译中';
                statusBadge.className = 'badge bg-success';
                
                if (inputMicrophone.checked) {
                    statusBadge.classList.add('recording');
                }
                
                // 通知 WebSocket
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(JSON.stringify({ command: 'resume' }));
                }
            } else {
                addLog('恢复翻译失败', 'error');
            }
        })
        .catch(error => {
            addLog(`恢复翻译出错: ${error}`, 'error');
        });
    });
    
    // 停止翻译
    stopBtn.addEventListener('click', function() {
        if (!sessionId) {
            addLog('没有活跃的翻译会话', 'error');
            return;
        }
        
        // 先通知 WebSocket 停止
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            try {
                websocket.send(JSON.stringify({ command: 'stop' }));
            } catch (e) {
                console.error('发送停止命令到 WebSocket 失败:', e);
            }
        }
        
        // 添加错误处理和重试逻辑
        const stopTranslation = function(retryCount = 0) {
            fetch('/api/stop_translation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ session_id: sessionId })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`服务器返回错误: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    addLog('翻译已停止', 'info');
                    
                    // 关闭 WebSocket 连接
                    if (websocket) {
                        try {
                            websocket.close();
                        } catch (e) {
                            console.error('关闭 WebSocket 连接失败:', e);
                        }
                        websocket = null;
                    }
                    
                    // 重置状态
                    resetTranslationSession();
                } else {
                    addLog(`停止翻译失败: ${data.message || '未知错误'}`, 'error');
                }
            })
            .catch(error => {
                console.error('停止翻译请求失败:', error);
                
                if (retryCount < 3) {
                    // 重试
                    addLog(`停止翻译请求失败，正在重试 (${retryCount + 1}/3)...`, 'warning');
                    setTimeout(() => stopTranslation(retryCount + 1), 1000);
                } else {
                    addLog(`停止翻译出错: ${error.message}`, 'error');
                    
                    // 即使请求失败，也重置前端状态
                    if (websocket) {
                        try {
                            websocket.close();
                        } catch (e) {
                            console.error('关闭 WebSocket 连接失败:', e);
                        }
                        websocket = null;
                    }
                    
                    resetTranslationSession();
                }
            });
        };
        
        // 开始停止流程
        addLog('正在停止翻译...', 'info');
        stopTranslation();
    });
    
    // 导出结果
    exportBtn.addEventListener('click', function() {
        if (Object.keys(translationData.translations).length === 0 && translationData.transcription.length === 0) {
            addLog('没有可导出的翻译结果', 'warning');
            return;
        }
        
        // 格式化导出数据
        const exportData = {
            source_language: sourceLanguageSelect.value,
            transcription: translationData.transcription,
            translations: {}
        };
        
        // 添加翻译结果
        for (const lang in translationData.translations) {
            exportData.translations[lang] = translationData.translations[lang];
        }
        
        // 创建下载链接
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = `translation_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        addLog('翻译结果已导出', 'success');
    });
    
    // 重置翻译会话状态
    function resetTranslationSession() {
        sessionId = null;
        isPaused = false;
        
        // 重置 UI
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="bi bi-play-fill"></i> 开始翻译';
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
        stopBtn.disabled = true;
        exportBtn.disabled = true;
        
        statusBadge.textContent = '就绪';
        statusBadge.className = 'badge bg-light text-primary';
        statusBadge.classList.remove('recording');
        
        // 清空结果区域
        // 注意：这里不清空结果，以便用户可以查看之前的结果
        // 如果需要清空，取消下面的注释
        // transcriptionResult.innerHTML = '';
        // translationResults.innerHTML = '';
    }
    
    // 重置翻译数据
    function resetTranslationData() {
        translationData = {
            transcription: [],
            translations: {}
        };
        
        // 清空结果显示
        transcriptionResult.innerHTML = '';
        translationResults.innerHTML = '';
    }
    
    // 连接 WebSocket
    function connectWebSocket(url) {
        console.log(`尝试连接 WebSocket: ${url}`);
        
        // 关闭现有连接
        if (websocket) {
            try {
                websocket.close();
            } catch (e) {
                console.error('关闭现有 WebSocket 连接失败:', e);
            }
            websocket = null;
        }
        
        try {
            // 创建新连接
            websocket = new WebSocket(url);
            
            websocket.onopen = function(event) {
                console.log('WebSocket 连接已打开');
                addLog('WebSocket 连接已建立', 'success');
            };
            
            websocket.onmessage = function(event) {
                console.log('收到 WebSocket 消息:', event.data);
                try {
                    const data = JSON.parse(event.data);
                    
                    // 处理错误
                    if (data.status === 'error') {
                        addLog(`翻译错误: ${data.message || '未知错误'}`, 'error');
                        return;
                    }
                    
                    // 处理完成状态
                    if (data.status === 'complete') {
                        addLog('翻译已完成', 'success');
                        return;
                    }
                    
                    // 处理连接状态
                    if (data.status === 'connected') {
                        addLog('WebSocket 连接已确认', 'success');
                        return;
                    }
                    
                    // 处理暂停/恢复状态
                    if (data.status === 'paused') {
                        addLog('翻译已暂停', 'info');
                        return;
                    }
                    
                    if (data.status === 'resumed') {
                        addLog('翻译已恢复', 'info');
                        return;
                    }
                    
                    if (data.status === 'stopped') {
                        addLog('翻译已停止', 'info');
                        return;
                    }
                    
                    // 处理识别结果
                    if (data.transcription) {
                        updateTranscription(data.transcription);
                    }
                    
                    // 处理翻译结果
                    if (data.translations) {
                        for (const lang in data.translations) {
                            updateTranslation(lang, data.translations[lang]);
                        }
                    }
                } catch (e) {
                    console.error('处理 WebSocket 消息失败:', e);
                    addLog(`处理消息失败: ${e.message}`, 'error');
                }
            };
            
            websocket.onclose = function(event) {
                console.log('WebSocket 连接已关闭', event.code, event.reason);
                addLog(`WebSocket 连接已关闭${event.code ? ` (代码: ${event.code})` : ''}`, 'info');
                websocket = null;
            };
            
            websocket.onerror = function(event) {
                console.error('WebSocket 错误:', event);
                addLog('WebSocket 连接错误，请检查网络连接或刷新页面重试', 'error');
            };
        } catch (e) {
            console.error('创建 WebSocket 连接失败:', e);
            addLog(`创建 WebSocket 连接失败: ${e.message}`, 'error');
        }
    }
    
    // 更新识别结果
    function updateTranscription(result) {
        if (!result) return;
        
        // 查找或创建当前句子
        let currentSentence = translationData.transcription.find(s => s.sentence_id === result.sentence_id);
        
        if (!currentSentence) {
            currentSentence = {
                sentence_id: result.sentence_id,
                text: result.text,
                is_complete: result.is_sentence_end
            };
            translationData.transcription.push(currentSentence);
        } else {
            currentSentence.text = result.text;
            currentSentence.is_complete = result.is_sentence_end;
        }
        
        // 更新显示
        updateTranscriptionDisplay();
    }
    
    // 更新翻译结果
    function updateTranslation(language, result) {
        if (!result) return;
        
        // 确保语言存在
        if (!translationData.translations[language]) {
            translationData.translations[language] = [];
        }
        
        // 查找或创建当前句子
        let currentSentence = translationData.translations[language].find(s => s.sentence_id === result.sentence_id);
        
        if (!currentSentence) {
            currentSentence = {
                sentence_id: result.sentence_id,
                text: result.text,
                is_complete: result.is_sentence_end
            };
            translationData.translations[language].push(currentSentence);
        } else {
            currentSentence.text = result.text;
            currentSentence.is_complete = result.is_sentence_end;
        }
        
        // 更新显示
        updateTranslationDisplay(language);
    }
    
    // 更新识别结果显示
    function updateTranscriptionDisplay() {
        transcriptionResult.innerHTML = '';
        
        translationData.transcription.forEach(sentence => {
            const div = document.createElement('div');
            div.className = 'sentence';
            
            if (sentence.is_complete) {
                div.classList.add('complete');
            } else {
                div.classList.add('current');
            }
            
            div.textContent = sentence.text;
            transcriptionResult.appendChild(div);
        });
        
        // 滚动到底部
        transcriptionResult.scrollTop = transcriptionResult.scrollHeight;
    }
    
    // 更新翻译结果显示
    function updateTranslationDisplay(language) {
        // 查找或创建语言容器
        let langContainer = document.getElementById(`translation-${language}`);
        
        if (!langContainer) {
            // 创建新的语言容器
            const langDiv = document.createElement('div');
            langDiv.className = 'card mb-3 border-0 shadow-sm';
            
            const langHeader = document.createElement('div');
            langHeader.className = 'card-header bg-white';
            langHeader.innerHTML = `<i class="bi bi-translate"></i> ${getLanguageName(language)}`;
            
            const langBody = document.createElement('div');
            langBody.className = 'card-body';
            
            langContainer = document.createElement('div');
            langContainer.id = `translation-${language}`;
            langContainer.className = 'result-box';
            
            langBody.appendChild(langContainer);
            langDiv.appendChild(langHeader);
            langDiv.appendChild(langBody);
            
            translationResults.appendChild(langDiv);
        }
        
        // 清空并重新填充
        langContainer.innerHTML = '';
        
        if (translationData.translations[language]) {
            translationData.translations[language].forEach(sentence => {
                const div = document.createElement('div');
                div.className = 'sentence';
                
                if (sentence.is_complete) {
                    div.classList.add('complete');
                } else {
                    div.classList.add('current');
                }
                div.textContent = sentence.text;
                langContainer.appendChild(div);
            });
        }
        
        // 滚动到底部
        langContainer.scrollTop = langContainer.scrollHeight;
    }
    
    // 获取语言名称
    function getLanguageName(code) {
        const languages = {
            'zh': '中文',
            'en': '英语',
            'ja': '日语',
            'ko': '韩语',
            'fr': '法语',
            'de': '德语',
            'es': '西班牙语',
            'it': '意大利语',
            'ru': '俄语',
            'pt': '葡萄牙语',
            'ar': '阿拉伯语',
            'hi': '印地语',
            'th': '泰语',
            'vi': '越南语'
        };
        
        return languages[code] || code;
    }
    
    // 源语言变更时更新目标语言选项
    sourceLanguageSelect.addEventListener('change', function() {
        const sourceLanguage = this.value;
        updateTargetLanguages(sourceLanguage);
    });
    
    // 更新目标语言选项
    function updateTargetLanguages(sourceLanguage) {
        targetLanguagesDiv.innerHTML = '';
        
        if (!sourceLanguage) return;
        
        // 支持的翻译方向
        const supportedTranslations = {
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
        };
        
        const targetLangs = supportedTranslations[sourceLanguage] || [];
        
        targetLangs.forEach(lang => {
            const langName = getLanguageName(lang);
            
            const checkDiv = document.createElement('div');
            checkDiv.className = 'form-check';
            
            const input = document.createElement('input');
            input.className = 'form-check-input';
            input.type = 'checkbox';
            input.id = `lang-${lang}`;
            input.value = lang;
            
            const label = document.createElement('label');
            label.className = 'form-check-label';
            label.htmlFor = `lang-${lang}`;
            label.textContent = langName;
            
            checkDiv.appendChild(input);
            checkDiv.appendChild(label);
            
            targetLanguagesDiv.appendChild(checkDiv);
        });
    }
    
    // 添加文件选择事件处理
    audioFileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            const file = this.files[0];
            addLog(`已选择文件: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`, 'info');
        }
    });
    
    // 添加同步翻译按钮事件处理
    if (syncTranslateBtn) {
        syncTranslateBtn.addEventListener('click', function() {
            // 检查是否选择了文件
            const audioFile = document.getElementById('audioFile').files[0];
            if (!audioFile) {
                addLog('请选择音频文件', 'warning');
                return;
            }
            
            // 检查是否设置了 API Key
            const apiKey = getApiKey();
            if (!apiKey) {
                addLog('请先设置 API Key', 'warning');
                return;
            }
            
            // 检查是否选择了源语言和目标语言
            const sourceLanguage = sourceLanguageSelect.value;
            if (!sourceLanguage) {
                addLog('请选择源语言', 'warning');
                return;
            }
            
            const targetLanguages = [];
            document.querySelectorAll('#targetLanguages input[type="checkbox"]:checked').forEach(function(checkbox) {
                targetLanguages.push(checkbox.value);
            });
            
            if (targetLanguages.length === 0) {
                addLog('请至少选择一种目标语言', 'warning');
                return;
            }
            
            // 显示加载状态
            addLog('开始同步翻译...', 'info');
            syncTranslateBtn.disabled = true;
            syncTranslateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 处理中...';
            
            // 创建表单数据
            const formData = new FormData();
            formData.append('audio_file', audioFile);
            formData.append('source_language', sourceLanguage);
            formData.append('target_languages', targetLanguages.join(','));
            formData.append('api_key', apiKey);
            
            // 发送同步翻译请求
            fetch('/api/translate_file_sync', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                // 恢复按钮状态
                syncTranslateBtn.disabled = false;
                syncTranslateBtn.innerHTML = '同步翻译';
                
                if (data.success) {
                    addLog('同步翻译完成', 'success');
                    
                    // 显示转录结果
                    if (data.transcriptions && data.transcriptions.length > 0) {
                        const transcriptionDiv = document.getElementById('transcriptionResult');
                        if (transcriptionDiv) {
                            transcriptionDiv.innerHTML = '';
                            data.transcriptions.forEach(text => {
                                const p = document.createElement('p');
                                p.textContent = text;
                                transcriptionDiv.appendChild(p);
                            });
                        }
                    }
                    
                    // 显示翻译结果
                    if (data.translations) {
                        const translationDiv = document.getElementById('translationResult');
                        if (translationDiv) {
                            translationDiv.innerHTML = '';
                            
                            for (const [lang, texts] of Object.entries(data.translations)) {
                                const langDiv = document.createElement('div');
                                langDiv.className = 'mb-3';
                                
                                const langTitle = document.createElement('h5');
                                langTitle.textContent = getLanguageName(lang);
                                langDiv.appendChild(langTitle);
                                
                                texts.forEach(text => {
                                    const p = document.createElement('p');
                                    p.textContent = text;
                                    langDiv.appendChild(p);
                                });
                                
                                translationDiv.appendChild(langDiv);
                            }
                        }
                    }
                } else {
                    addLog(`同步翻译失败: ${data.error || data.message || '未知错误'}`, 'error');
                }
            })
            .catch(error => {
                // 恢复按钮状态
                syncTranslateBtn.disabled = false;
                syncTranslateBtn.innerHTML = '同步翻译';
                
                addLog(`请求出错: ${error.message}`, 'error');
            });
        });
    }
    
    // 获取 API Key
    function getApiKey() {
        // 首先从 localStorage 获取
        const apiKey = localStorage.getItem('api_key');
        if (apiKey) {
            return apiKey;
        }
        
        // 如果没有，尝试从输入框获取
        const apiKeyInput = document.getElementById('apiKey');
        if (apiKeyInput && apiKeyInput.value.trim()) {
            // 保存到 localStorage 以便后续使用
            localStorage.setItem('api_key', apiKeyInput.value.trim());
            return apiKeyInput.value.trim();
        }
        
        return null;
    }
    
    // 初始化
    addLog('系统已就绪', 'info');
    
    // 初始化源语言选择器
    fetch('/api/languages')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // 填充源语言选择器
                sourceLanguageSelect.innerHTML = '<option value="">请选择源语言</option>';
                
                for (const [code, name] of Object.entries(data.languages)) {
                    const option = document.createElement('option');
                    option.value = code;
                    option.textContent = name;
                    sourceLanguageSelect.appendChild(option);
                }
            }
        })
        .catch(error => {
            console.error('获取语言列表失败:', error);
            
            // 使用默认语言列表
            const defaultLanguages = {
                "zh": "中文",
                "en": "英文",
                "ja": "日语",
                "yue": "粤语",
                "ko": "韩语"
            };
            
            sourceLanguageSelect.innerHTML = '<option value="">请选择源语言</option>';
            
            for (const [code, name] of Object.entries(defaultLanguages)) {
                const option = document.createElement('option');
                option.value = code;
                option.textContent = name;
                sourceLanguageSelect.appendChild(option);
            }
        });
}); 