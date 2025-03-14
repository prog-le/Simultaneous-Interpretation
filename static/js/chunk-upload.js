// 分块上传大文件
function uploadLargeFile(file, sessionId) {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB 每块
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let currentChunk = 0;
    
    addLog(`准备分块上传文件: ${file.name}, 总大小: ${(file.size / (1024 * 1024)).toFixed(2)} MB, 分为 ${totalChunks} 块`, 'info');
    
    function uploadNextChunk() {
        if (currentChunk >= totalChunks) {
            // 所有块上传完成
            addLog('所有分块上传完成，正在处理文件...', 'info');
            
            // 通知服务器所有块已上传完成
            fetch('/api/complete_upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    filename: file.name,
                    total_chunks: totalChunks
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    addLog('文件处理成功', 'success');
                } else {
                    addLog(`文件处理失败: ${data.message}`, 'error');
                }
            })
            .catch(error => {
                addLog(`完成上传请求失败: ${error.message}`, 'error');
            });
            
            return;
        }
        
        // 计算当前块的范围
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunk = file.slice(start, end);
        
        // 创建表单数据
        const formData = new FormData();
        formData.append('chunk', chunk);
        formData.append('session_id', sessionId);
        formData.append('filename', file.name);
        formData.append('chunk_index', currentChunk);
        formData.append('total_chunks', totalChunks);
        
        // 上传当前块
        addLog(`上传分块 ${currentChunk + 1}/${totalChunks}...`, 'info');
        
        fetch('/api/upload_chunk', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentChunk++;
                const progress = (currentChunk / totalChunks) * 100;
                addLog(`分块 ${currentChunk}/${totalChunks} 上传成功 (${progress.toFixed(2)}%)`, 'info');
                
                // 上传下一块
                uploadNextChunk();
            } else {
                addLog(`分块上传失败: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            addLog(`分块上传出错: ${error.message}`, 'error');
        });
    }
    
    // 开始上传第一块
    uploadNextChunk();
} 