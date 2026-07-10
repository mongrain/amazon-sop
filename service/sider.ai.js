async function getFileId(file) {
  const axios = require('axios');
  const FormData = require('form-data');
  const fs = require('fs');
  const crypto = require('crypto');

  function getImageMd5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  let data = new FormData();
  data.append('file', fs.createReadStream(file));
  data.append('hash', await getImageMd5(file));
  data.append('mime', 'image/jpeg');
  data.append('app_name', 'ChitChat_Chrome_Ext');
  data.append('app_version', '5.27.0');
  data.append('tz_name', 'Asia/Shanghai');
  data.append('tasks', '[]');
  data.append('meta', '{"width":40,"height":240}');

  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api3.chatgpt-sidebar.com/api/uploader/v1/file/upload-directly',
    headers: {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4NjM4OTE1LCJyZWdpc3Rlcl90eXBlIjoib2F1dGgyIiwiYXBwX25hbWUiOiJDaGl0Q2hhdF9XZWIiLCJ0b2tlbl9pZCI6IjdjMDU3NjQ3LWE1MmEtNDNiZS04ZDk3LWI5NjQ1NjIzMGI5ZSIsImlzcyI6InNpZGVyLmFpIiwiYXVkIjpbIiJdLCJleHAiOjE4MDQ4NjM1ODYsIm5iZiI6MTc3Mzc1OTU4NiwiaWF0IjoxNzczNzU5NTg2fQ.2D5uwHVFnCtDvVfvOWRxLMCsMJhX1h1Um6GvOuGvhaI',
      'cache-control': 'no-cache',
      'origin': 'chrome-extension://difoiogjjojoaoomphldepapgpbgkhkb',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'none',
      'sec-fetch-storage-access': 'active',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'x-app-name': 'ChitChat_Chrome_Ext',
      'x-app-version': '5.27.0',
      'x-time-zone': 'Asia/Shanghai',
      'x-trace-id': '76c5468a-b745-4e65-937a-f8ca1522e4e1',
      'Cookie': 'CloudFront-Key-Pair-Id=K344F5VVSSM536; CloudFront-Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9maWxlLWNkbi5zaWRlci5haS8qL1UwR1ZISzczVzdMLyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3ODM3ODI5NjF9fX1dfQ__; CloudFront-Signature=GOi-rEWR0u3dAcnJTrQNt6mmQDKr8vBAOY8MsKqtmVZDr-4fqHUfn9IkkeC5vfMNMCLwSwSNmGCf2J007llWFcCTOpIAevEkVK5mMe2tKsAXkP9U30o7g9qHyI4AA43WpsWx3Dt9Sty6B5D75pZsbfnxMA-13SXJ52EMuMwWMYGIy3Gt5IXBY6s8oWuUxqIaUh1hOsHvPYXQ1nuPCWfA8MdfWxDBHJRcMCsK1Hvi7pX3WkLBjZoe~x9CQ4DsG2Fb1dOLd-Y4ekMF~K-GVu4i~nqRjxwXgWOT8iVH37WyJsD~zklRz9R8nKHGTsNimdIuynuNHHqjoXa82D2ko7~cOg__; CloudFront-Key-Pair-Id=K344F5VVSSM536; CloudFront-Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9maWxlLWNkbi5zaWRlci5haS8qL1UwR1ZISzczVzdMLyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3ODM3ODMwNjR9fX1dfQ__; CloudFront-Signature=SaDDzXl-yEv8nK~nql7uDFsikKUy~GqsQ7fJZVqyBe1Yk5Uiz9Nusy~la9yIzi2ya9xZL-C~-iX31b0DUKtpW8T-~gC256mNJqZqsOmq07M4o2zSsQKKo3cmm0UJD5gMJPvtbrMaATx72QcpxuXSUZ~7jaWOd1bG2YurDCCe3ksEd3Tw9fD73OMZq-vy-PEq855Tp-BLVEFS1Tg2--4lPIPNWeI4EaH7Szh1Ii613ogB6VDs5VSdR9RwKnYZFU2kJkYqFS3meLE8WxcKLrgzqhDyuolNqUg-ahL52xW8laDlA42mtqfSXXFJVLYagTZkyiNwhDI0dCSXhbVhaK9UVA__',
      ...data.getHeaders()
    },
    data: data
  };

  return await axios.request(config)
    .then((response) => {
      console.log('response', response.data);
      return response.data.data.fileID;
    });
}


function siderAi(fileId1, fileId2, prompt, cid = '', parentMessageId = '') {
  return new Promise(async (resolve, reject) => {
    const response = await fetch('https://api3.chatgpt-sidebar.com/api/chat/v1/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4NjM4OTE1LCJyZWdpc3Rlcl90eXBlIjoib2F1dGgyIiwiYXBwX25hbWUiOiJDaGl0Q2hhdF9XZWIiLCJ0b2tlbl9pZCI6IjdjMDU3NjQ3LWE1MmEtNDNiZS04ZDk3LWI5NjQ1NjIzMGI5ZSIsImlzcyI6InNpZGVyLmFpIiwiYXVkIjpbIiJdLCJleHAiOjE4MDQ4NjM1ODYsIm5iZiI6MTc3Mzc1OTU4NiwiaWF0IjoxNzczNzU5NTg2fQ.2D5uwHVFnCtDvVfvOWRxLMCsMJhX1h1Um6GvOuGvhaI',
        'Content-Type': 'application/json',
        'x-app-name': 'ChitChat_Chrome_Ext',
        'x-app-version': '5.27.0'
      },
      body: JSON.stringify({
        stream: false,
        cid: cid,
        model: 'sider',
        parent_message_id: parentMessageId,
        multi_content: [
          {
            "type": "file",
            "file": {
              "type": "image",
              "file_id": fileId1
            }
          },
          {
            "type": "file",
            "file": {
              "type": "image",
              "file_id": fileId2
            }
          },
          {
            "type": "text",
            "text": prompt,
            "user_input_text": prompt
          }
        ]
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let nextMessageId = '';

    const parseDataLine = (line) => {
      if (!line.startsWith('data:')) return;
      const jsonStr = line.slice(5).trim();
      if (jsonStr === '[DONE]') return;
      const parsed = JSON.parse(jsonStr);
      if (parsed?.data?.type === 'text' && parsed.data.text) {
        fullText += parsed.data.text;
      }
      if (parsed?.data?.type === 'message_start' && parsed.data.message_start) {
        cid = parsed.data.message_start.cid;
        nextMessageId = parsed.data.message_start.assistant_message_id;
      }
    };

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          parseDataLine(line);
        } catch (e) {
          reject(e);
          return;
        }
      }

      if (done) {
        if (buffer.trim()) {
          try {
            parseDataLine(buffer);
          } catch (e) {
            reject(e);
            return;
          }
        }
        break;
      }
    }

    if (!fullText.trim()) {
      reject(new Error('未收到有效响应'));
      return;
    }

    const start = fullText.indexOf('{');
    const end = fullText.lastIndexOf('}');
    if (start === -1 || end <= start) {
      reject(new Error('未找到有效 JSON 响应'));
      return;
    }

    try {
      const result = JSON.parse(fullText.slice(start, end + 1));
      resolve({
        result,
        cid,
        nextMessageId
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  getFileId,
  siderAi
}
