import React, { useState, useRef, useEffect } from "react";
import { marked } from "marked";

// 이미지 경로 추출 정규식
const IMAGE_MD_REGEX = /!\[[^\]]*\]\((img\/[^\)]+)\)/g;

function isSupported() {
  return (
    "showDirectoryPicker" in window &&
    (window.SpeechRecognition || window.webkitSpeechRecognition) &&
    "mediaDevices" in navigator &&
    "geolocation" in navigator
  );
}

export default function App() {
  const [folderHandle, setFolderHandle] = useState(null);
  const [fileHandles, setFileHandles] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [mode, setMode] = useState("idle");
  const [message, setMessage] = useState("");
  const [writingValue, setWritingValue] = useState("");
  const [imgUrlMap, setImgUrlMap] = useState({});
  const textareaRef = useRef(null);
  const speechRef = useRef(null);
  const fileInputRef = useRef(null);

  // 이미지 Blob URL 생성 및 관리
  useEffect(() => {
    if (!folderHandle || (!fileContent && !writingValue)) return;
    const md = mode === "writing" ? writingValue : fileContent;
    const matches = [...md.matchAll(IMAGE_MD_REGEX)];
    if (matches.length === 0) return;
    let isUnmounted = false;

    (async () => {
      const imgFolder = await folderHandle.getDirectoryHandle("img", { create: false }).catch(() => null);
      if (!imgFolder) return;
      const newMap = {};
      for (const match of matches) {
        const relPath = match[1];
        const fileName = relPath.replace(/^img\//, "");
        try {
          const fileHandle = await imgFolder.getFileHandle(fileName, {});
          const file = await fileHandle.getFile();
          const blobUrl = URL.createObjectURL(file);
          newMap[relPath] = blobUrl;
        } catch {
          // 파일이 없을 수도 있음
        }
      }
      if (!isUnmounted) setImgUrlMap(newMap);
      return () => {
        isUnmounted = true;
        Object.values(imgUrlMap).forEach(url => URL.revokeObjectURL(url));
      };
    })();
    // eslint-disable-next-line
  }, [folderHandle, fileContent, writingValue, mode]);

  // 마크다운 렌더링: 이미지 경로를 Blob URL로 대체
  function renderMarkdown(md) {
    let html = marked.parse(md || "");
    html = html.replace(/<img\s+([^>]*?)src="(img\/[^"]+)"([^>]*)>/g, (tag, pre, src, post) => {
      if (imgUrlMap[src]) {
        return `<img ${pre}src="${imgUrlMap[src]}"${post}>`;
      }
      return tag;
    });
    return { __html: html };
  }

  // Documents/SummitCrew 폴더 안내 및 선택
  async function selectSummitFolder() {
    try {
      alert(
        "반드시 'Documents/SummitCrew' 폴더를 선택하거나, 없으면 직접 생성해서 선택하세요.\n" +
        "이 폴더가 앱의 기본 저장소로 사용됩니다."
      );
      const handle = await window.showDirectoryPicker();
      setFolderHandle(handle);
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === "file" && entry.name.endsWith(".md")) {
          files.push(entry);
        }
      }
      setFileHandles(files);
      setMessage("파일을 선택하거나 새로 만드세요.");
    } catch {
      setMessage("폴더 접근이 거부되었습니다.");
    }
  }

  async function openFile(fileHandle) {
    const file = await fileHandle.getFile();
    const text = await file.text();
    setCurrentFile(fileHandle);
    setFileContent(text);
    setMode("listening");
    setMessage("음성 명령 또는 버튼을 사용할 수 있습니다.");
    startListening();
  }

  async function createNewFile() {
    const fileName = prompt("새 파일 이름을 입력하세요 (.md 포함)", `일기_${new Date().toISOString().slice(0,10)}.md`);
    if (!fileName) return;
    const handle = await folderHandle.getFileHandle(fileName, { create: true });
    await saveFile(handle, "");
    setFileHandles([...fileHandles, handle]);
    openFile(handle);
  }

  async function saveFile(fileHandle, content) {
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  function startListening() {
    if (speechRef.current) {
      speechRef.current.stop();
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = async (event) => {
      const transcript = event.results[event.resultIndex][0].transcript.trim();
      setMessage(`명령어: ${transcript}`);
      if (transcript.includes("사진")) {
        recognition.stop();
        await handleTakePhoto();
        startListening();
      } else if (transcript.includes("글쓰기 시작")) {
        handleStartWriting();
      } else if (transcript.includes("글쓰기 끝")) {
        await handleEndWriting();
        startListening();
      } else if (transcript.includes("종료") || transcript.toLowerCase().includes("stop")) {
        recognition.stop();
        await saveFile(currentFile, fileContent);
        setMessage("앱을 종료합니다.");
        setMode("idle");
      } else if (mode === "writing") {
        setWritingValue((prev) => {
          let newPrev = prev;
          if (newPrev && !newPrev.endsWith("\n")) newPrev += "\n";
          return newPrev + transcript + "\n";
        });
      }
    };

    recognition.onerror = (event) => {
      setMessage("음성 인식 오류: " + event.error);
    };

    recognition.onend = () => {
      if (mode === "listening") {
        recognition.start();
      }
    };

    speechRef.current = recognition;
    recognition.start();
  }

  function handleStartWriting() {
    setMode("writing");
    setWritingValue(fileContent);
    setMessage('글 전체를 편집할 수 있습니다. 사진은 ![](img/...) 형태로 표시됩니다.');
    if (speechRef.current) speechRef.current.stop();
  }

  async function handleEndWriting() {
    setMode("listening");
    setFileContent(writingValue);
    await saveFile(currentFile, writingValue);
    setWritingValue("");
    setMessage("글쓰기 종료. 음성 명령 또는 버튼을 사용할 수 있습니다.");
    if (speechRef.current) startListening();
  }

  async function handleTakePhoto() {
    setMode("takingPhoto");
    setMessage("사진 촬영 중...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg"));

      let lat = "unknown", lng = "unknown";
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            lat = pos.coords.latitude.toFixed(6);
            lng = pos.coords.longitude.toFixed(6);
            resolve();
          },
          () => resolve()
        );
      });

      const now = new Date();
      const fileName = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}-${lat}-${lng}.jpg`;

      const imgFolder = await folderHandle.getDirectoryHandle("img", { create: true });
      const imgFileHandle = await imgFolder.getFileHandle(fileName, { create: true });
      const writable = await imgFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      const imgPath = `img/${fileName}`;
      const mdLink = `![](${imgPath})`;

      if (mode === "writing" && textareaRef.current) {
        insertAtCursorWithNewline(mdLink);
      } else {
        setFileContent((prev) => {
          let newPrev = prev;
          if (newPrev && !newPrev.endsWith("\n")) newPrev += "\n";
          return newPrev + mdLink + "\n";
        });
        await saveFile(currentFile, (fileContent && !fileContent.endsWith("\n") ? fileContent + "\n" : fileContent) + mdLink + "\n");
      }

      setMessage("사진 저장 및 태그 삽입 완료.");
      setMode(mode === "writing" ? "writing" : "listening");
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      setMessage("사진 촬영 실패: " + e.message);
      setMode(mode === "writing" ? "writing" : "listening");
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setMessage("사진 업로드 중...");
    try {
      const imgFolder = await folderHandle.getDirectoryHandle("img", { create: true });
      const now = new Date();
      const fileName = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}-${file.name}`;
      const imgFileHandle = await imgFolder.getFileHandle(fileName, { create: true });
      const writable = await imgFileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      const imgPath = `img/${fileName}`;
      const mdLink = `![](${imgPath})`;

      if (mode === "writing" && textareaRef.current) {
        insertAtCursorWithNewline(mdLink);
      } else {
        setFileContent((prev) => {
          let newPrev = prev;
          if (newPrev && !newPrev.endsWith("\n")) newPrev += "\n";
          return newPrev + mdLink + "\n";
        });
        await saveFile(currentFile, (fileContent && !fileContent.endsWith("\n") ? fileContent + "\n" : fileContent) + mdLink + "\n");
      }
      setMessage("사진 업로드 및 태그 삽입 완료.");
    } catch (e) {
      setMessage("사진 업로드 실패: " + e.message);
    }
    e.target.value = "";
  }

  function insertAtCursorWithNewline(text) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    let before = writingValue.slice(0, start);
    let after = writingValue.slice(end);

    if (before && !before.endsWith("\n")) before += "\n";
    if (after && !after.startsWith("\n")) text += "\n";
    const newValue = before + text + after;
    setWritingValue(newValue);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = before.length + text.length;
    }, 0);
  }

  async function handleStop() {
    if (speechRef.current) speechRef.current.stop();
    await saveFile(currentFile, fileContent);
    setMessage("앱을 종료합니다.");
    setMode("idle");
  }

  function handleWritingChange(e) {
    setWritingValue(e.target.value);
  }

  // 엔터키에 <br> 자동 삽입
  function handleWritingKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = writingValue.slice(0, start);
      const after = writingValue.slice(end);
      const newValue = before + "<br>\n" + after;
      setWritingValue(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + 5;
      }, 0);
    }
  }

  if (!isSupported()) {
    return <div>이 브라우저는 지원되지 않습니다. (크롬/엣지/iOS 최신 버전 권장)</div>;
  }

  if (!folderHandle) {
    return (
      <div>
        <button onClick={selectSummitFolder}>Documents/SummitCrew 폴더 선택</button>
        <div>{message}</div>
      </div>
    );
  }

  if (!currentFile) {
    return (
      <div>
        <ul>
          {fileHandles.map((fh) => (
            <li key={fh.name}>
              <button onClick={() => openFile(fh)}>{fh.name}</button>
            </li>
          ))}
        </ul>
        <button onClick={createNewFile}>새 파일 만들기</button>
        <div>{message}</div>
      </div>
    );
  }

  if (mode === "writing") {
    return (
      <div>
        <h2>{currentFile.name}</h2>
        <div style={{ display: "flex", gap: "2em" }}>
          <div style={{ flex: 1 }}>
            <h4>편집(.md)</h4>
            <textarea
              ref={textareaRef}
              value={writingValue}
              onChange={handleWritingChange}
              onKeyDown={handleWritingKeyDown}
              rows={16}
              style={{ width: "100%", fontSize: "1em" }}
              placeholder="여기에 기존 글 전체가 표시됩니다. 사진은 ![](img/...) 태그로 보이며, 자유롭게 편집할 수 있습니다."
            />
          </div>
          <div style={{ flex: 1, borderLeft: "1px solid #ccc", paddingLeft: "1em" }}>
            <h4>미리보기</h4>
            <div
              style={{ background: "#fafafa", minHeight: "200px", padding: "1em" }}
              dangerouslySetInnerHTML={renderMarkdown(writingValue)}
            />
          </div>
        </div>
        <div style={{ margin: "1em 0" }}>
          <button onClick={handleTakePhoto} disabled={mode === "takingPhoto"}>사진 촬영</button>
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()}>사진 업로드</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <button onClick={handleEndWriting}>글쓰기 종료</button>
          <button onClick={handleStop}>종료</button>
        </div>
        <div>{message}</div>
      </div>
    );
  }

  return (
    <div>
      <h2>{currentFile.name}</h2>
      <div style={{ display: "flex", gap: "2em" }}>
        <div style={{ flex: 1 }}>
          <h4>원본(.md)</h4>
          <pre style={{ background: "#eee", padding: "1em", minHeight: "200px" }}>{fileContent}</pre>
        </div>
        <div style={{ flex: 1, borderLeft: "1px solid #ccc", paddingLeft: "1em" }}>
          <h4>미리보기</h4>
          <div
            style={{ background: "#fafafa", minHeight: "200px", padding: "1em" }}
            dangerouslySetInnerHTML={renderMarkdown(fileContent)}
          />
        </div>
      </div>
      <div style={{ margin: "1em 0" }}>
        <button onClick={handleTakePhoto} disabled={mode === "takingPhoto"}>사진 촬영</button>
        <button onClick={() => fileInputRef.current && fileInputRef.current.click()}>사진 업로드</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        <button onClick={handleStartWriting}>글쓰기 시작</button>
        <button onClick={handleStop}>종료</button>
      </div>
      <div>{message}</div>
    </div>
  );
}
