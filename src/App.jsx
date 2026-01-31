import React, { useState } from 'react';
import {
  MessageSquare, CheckCircle, Calculator, ChevronRight, Copy, RefreshCw, AlertCircle, ShieldCheck, Sparkles, Bot,
  PenTool, Database
} from 'lucide-react';

// --- NocoDB 配置 ---
// 从环境变量读取配置
const NOCODB_CONFIG = {
  baseUrl: import.meta.env.VITE_NOCODB_BASE_URL,
  tableId: import.meta.env.VITE_NOCODB_TABLE_ID,
  apiToken: import.meta.env.VITE_NOCODB_API_TOKEN
};

// --- OpenAI API 调用 ---
const generateContent = async (prompt, systemInstruction) => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  const apiUrl = import.meta.env.VITE_OPENAI_API_URL || "https://api.openai.com/v1";
  const model = import.meta.env.VITE_OPENAI_MODEL_ID || "gpt-3.5-turbo";

  if (!apiKey) {
    throw new Error("OpenAI API Key 未配置，请在环境变量中设置 VITE_OPENAI_API_KEY");
  }

  try {
    const response = await fetch(
      `${apiUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" } // 强制 JSON 输出，需模型支持
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from model");
    }

    // 尝试提取 JSON 部分 (从第一个 { 到 最后一个 })
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      content = content.substring(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(content);
    } catch (e) {
      console.error("JSON Parse Error. Raw content:", content);
      throw new Error(`JSON 解析失败: ${e.message}`);
    }
  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw error;
  }
};

// --- NocoDB 保存逻辑 ---
const saveToNocoDB = async (request, qaData, quoteData) => {
  if (!NOCODB_CONFIG.apiToken || !NOCODB_CONFIG.baseUrl || !NOCODB_CONFIG.tableId) {
    console.warn("NocoDB 配置不完整，跳过保存。");
    return;
  }

  try {
    // 构造 QA 字符串以便阅读
    const qaFormatted = qaData.questions.map(q => ({
      question: q.text,
      answer: qaData.answers[q.id]
    }));

    const payload = {
      "User_Request": request,
      "Questions_Answers": JSON.stringify(qaFormatted, null, 2),
      "Quote_Details": JSON.stringify(quoteData, null, 2),
      "Status": "Generated"
    };

    const response = await fetch(
      `${NOCODB_CONFIG.baseUrl}/api/v2/tables/${NOCODB_CONFIG.tableId}/records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xc-token": NOCODB_CONFIG.apiToken
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      console.error("NocoDB Save Failed:", await response.text());
    } else {
      console.log("Data saved to NocoDB successfully");
    }
  } catch (error) {
    console.error("NocoDB Error:", error);
  }
};

// --- 组件部分 ---

const App = () => {
  const [step, setStep] = useState('input'); // input, analyzing, questions, calculating, quote
  const [userRequest, setUserRequest] = useState('');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [customInputModes, setCustomInputModes] = useState({});
  const [quoteData, setQuoteData] = useState(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 1. 获取需求，生成问题
  const handleAnalyzeRequest = async () => {
    if (!userRequest.trim()) return;
    setStep('analyzing');
    setError('');

    const systemPrompt = `
      你是一个专业的 AI 解决方案顾问。现在有一位客户想要定制 AI 工具或工作流（如 Dify, Coze, n8n, ComfyUI 等）。

      任务：
      1. 理解客户的想法。
      2. 为了给出准确的方案和报价，生成 3 到 5 个关键的选择题询问细节。
      3. 语气要亲切、专业、以服务为导向。不要使用技术黑话，除非非常有必要。
      4. 问题旨在厘清：输入是什么？输出要什么？是否需要全自动？
      5. **重要**: 输出纯净的 JSON 格式。所有字符串内部的换行符必须转义为 \\n，双引号必须转义为 \\" 。严禁输出 Markdown 代码块标记。

      JSON 结构示例：
      {
        "questions": [
          {
            "id": 1,
            "text": "您手头已经有整理好的素材内容吗？",
            "options": ["有现成的文档/文字稿", "只有视频链接，需要提取", "什么都没有，需要AI自动生成"]
          }
        ]
      }
    `;

    try {
      // 移除 apiKey 参数，直接在函数内读取 env
      const result = await generateContent(userRequest, systemPrompt);
      if (result && result.questions) {
        setQuestions(result.questions);
        const initialAnswers = {};
        result.questions.forEach(q => initialAnswers[q.id] = null);
        setAnswers(initialAnswers);
        setStep('questions');
      } else {
        throw new Error("格式解析失败，请重试");
      }
    } catch (e) {
      setError("网络有点拥堵，请重试或简化描述。" + e.message);
      setStep('input');
    }
  };

  // 2. 选择答案
  const handleSelectOption = (questionId, option) => {
    setCustomInputModes(prev => ({ ...prev, [questionId]: false }));
    setAnswers(prev => ({
      ...prev,
      [questionId]: option
    }));
  };

  const handleSelectOther = (questionId) => {
    setCustomInputModes(prev => ({ ...prev, [questionId]: true }));
    setAnswers(prev => ({ ...prev, [questionId]: '' }));
  };

  const handleCustomInputChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
  };

  // 3. 提交答案，生成报价，并保存到 NocoDB
  const handleGenerateQuote = async () => {
    const allAnswered = questions.every(q => {
      if (customInputModes[q.id]) {
        return answers[q.id] && answers[q.id].trim().length > 0;
      }
      return answers[q.id];
    });

    if (!allAnswered) {
      setError("请先完成所有选项（包括“其他”补充），以便我们为您定制方案");
      return;
    }

    setStep('calculating');
    setError('');

    const formattedQA = questions.map(q => `问：${q.text}\n答：${answers[q.id]}`).join('\n');

    const systemPrompt = `
      你是一个真诚的 AI 服务商。根据客户的需求和回答，为他生成一份**一次性交付（一口价）的预览报价方案**。

      原则：
      1. **定价策略**：采用一口价（One-time fee）交付工作流文件，**绝不要按月收费**。
      - 参考价格档位：
        * 基础版：约 199-599 元
        * 标准版：约 599-1299 元
        * 高级版：约 1499-2599 元
      2. **价值导向**：解释每个方案能帮客户省多少时间，或解决什么问题。
      3. **免责与说明**：
      - **费用说明**：报价不含服务器及 AI API 调用费用。
      - **仅供参考**：此方案仅供参考，不代表最终成交价。
      - **交付标准**：参考对标案例，相似度 80% 即视为交付成功。
      - **售后界限**：AI 具有随机性，不支持无限次修改。
      4. 输出 JSON 格式。**重要**: 严禁使用 Markdown 代码块。确保所有字符串内部的特殊字符（如换行符、双引号）都已正确转义（例如使用 \\n 和 \\"）。

      JSON 结构示例：
      {
        "tiers": [
          {
            "name": "基础版",
            "price": "599",
            "features": ["功能A", "功能B"],
            "desc": "描述"
          }
        ],
        "notes": ["注意事项1"],
        "analysis": "分析内容..."
      }
    `;

    const fullPrompt = `客户需求：${userRequest}\n\n确认细节：\n${formattedQA}`;

    try {
      const result = await generateContent(fullPrompt, systemPrompt);
      if (result && result.tiers) {
        setQuoteData(result);
        setStep('quote');

        // 异步保存到 NocoDB，不阻塞 UI
        setIsSaving(true);
        saveToNocoDB(userRequest, { questions, answers }, result)
          .then(() => setIsSaving(false))
          .catch(() => setIsSaving(false));

      } else {
        throw new Error("生成方案失败");
      }
    } catch (e) {
      setError("生成方案时遇到问题，请重试。" + e.message);
      setStep('questions');
    }
  };

  const copyToClipboard = () => {
    if (!quoteData) return;

    let text = `👋 您好，我在您的【自助报价页】生成了一个方案：\n\n📌 需求：${userRequest.substring(0, 15)}...\n`;
    questions.forEach(q => {
      text += `• ${q.text.substring(0, 10)}... : ${answers[q.id]}\n`;
    });
    text += `\n💰 我比较感兴趣的方案：\n`;
    quoteData.tiers.forEach(tier => {
      text += `【${tier.name}】 ¥${tier.price}\n`;
    });
    text += `\n麻烦您看一下能不能做？`;

    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert("已复制！请直接粘贴发送给卖家客服。");
    } catch (err) {
      console.error('Unable to copy', err);
    }
    document.body.removeChild(textArea);
  };

  const restart = () => {
    setStep('input');
    setUserRequest('');
    setQuestions([]);
    setAnswers({});
    setCustomInputModes({});
    setQuoteData(null);
  };

  // --- 界面渲染 ---

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-800 font-sans selection:bg-blue-200 flex flex-col">

      {/* Header - 修复：Z-Index 提升到 50 */}
      <header
        className="bg-white px-6 py-4 flex items-center justify-between border-b border-gray-100 z-50 sticky top-0 w-full shadow-sm">
        <div className="flex items-center space-x-2">
          <div className="bg-blue-600 text-white p-1.5 rounded-lg">
            <Bot size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-900 tracking-tight">AI 方案自助评估</h1>
            <p className="text-[10px] text-slate-400">智能匹配最适合您的方案</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 仅作展示，提示数据是否在保存 */}
          {isSaving && (
            <div className="text-xs text-blue-500 flex items-center gap-1 animate-pulse">
              <Database size={12} /> 保存中...
            </div>
          )}
          {step !== 'input' && (
            <button onClick={restart}
              className="text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1 text-sm font-medium">
              <RefreshCw size={16} /> 重置
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 overflow-y-auto pb-32">

        {error && (
          <div
            className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm flex items-center gap-2 animate-pulse border border-red-100">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* Step 1: Input */}
        {step === 'input' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto mt-10">
            <div className="space-y-3 text-center md:text-left">
              <h2 className="text-3xl font-bold text-slate-900">您想做一个什么工具？</h2>
              <p className="text-slate-500 text-lg">简单描述您的想法，AI 顾问将为您评估实现难度并预估费用。</p>
            </div>

            <div className="relative group shadow-sm rounded-xl">
              <textarea
                className="w-full h-48 p-6 bg-white border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all text-lg resize-none placeholder-slate-300"
                placeholder="例如：我想做一个能模仿我喜欢的博主风格自动写小红书文案的工具；或者想实现闲鱼自动发货机器人..." value={userRequest} onChange={(e) => setUserRequest(e.target.value)}
              />
              <div className="absolute bottom-4 right-4 text-sm text-slate-400 group-focus-within:text-blue-500 font-medium">
                {userRequest.length} 字
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl flex gap-4 items-start border border-blue-100 shadow-sm">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Sparkles className="text-blue-600" size={24} />
              </div>
              <div className="text-sm text-blue-900 leading-relaxed">
                <span className="font-bold block mb-1 text-base">为什么使用自助评估？</span>
                直接咨询由于信息不对称，往往需要沟通很久。使用此工具，您只需 1 分钟即可获得针对您需求的**定制方案**和**透明报价**。
              </div>
            </div>
          </div>
        )}

        {/* Loading States */}
        {(step === 'analyzing' || step === 'calculating') && (
          <div className="flex flex-col items-center justify-center h-[60vh] space-y-6">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-slate-100 rounded-full"></div>
              <div className="absolute top-0 left-0 w-20 h-20 border-4 border-blue-600 rounded-full animate-spin border-t-transparent"></div>
            </div>
            <p className="text-slate-500 font-medium animate-pulse text-lg">
              {step === 'analyzing' ? '正在分析技术实现路径...' : '正在为您精算成本并配置方案...'}
            </p>
          </div>
        )}

        {/* Step 2: Questions */}
        {step === 'questions' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 max-w-3xl mx-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">请确认定制细节</h2>
                <p className="text-slate-500 mt-1">为了确保方案可行，我们需要确认以下信息</p>
              </div>
              <span className="text-sm font-bold font-mono bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg border border-blue-100">Step 2 / 3</span>
            </div>

            <div className="space-y-8">
              {questions.map((q, idx) => (
                <div key={q.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-slate-800 text-lg leading-relaxed flex gap-3">
                    <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-lg text-sm flex items-center h-fit mt-1">Q{idx + 1}</span>
                    {q.text}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-0 md:pl-12">
                    {q.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => handleSelectOption(q.id, opt)}
                        className={`text-left px-5 py-4 rounded-xl text-sm transition-all flex items-center justify-between border-2 ${!customInputModes[q.id] && answers[q.id] === opt
                          ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm'
                          : 'bg-slate-50 border-transparent hover:bg-slate-100 text-slate-600 hover:border-slate-200'
                          }`}
                      >
                        <span className="line-clamp-2">{opt}</span>
                        {!customInputModes[q.id] && answers[q.id] === opt && <CheckCircle size={18} className="text-blue-600 shrink-0 ml-2" />}
                      </button>
                    ))}

                    {/* 其他选项按钮 */}
                    <button
                      onClick={() => handleSelectOther(q.id)}
                      className={`text-left px-5 py-4 rounded-xl text-sm transition-all flex items-center justify-between border-2 ${customInputModes[q.id]
                        ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm'
                        : 'bg-slate-50 border-transparent hover:bg-slate-100 text-slate-600 hover:border-slate-200'
                        }`}
                    >
                      <span className="flex items-center gap-2"><PenTool size={14} /> 其他情况 (手动输入)</span>
                      {customInputModes[q.id] && <CheckCircle size={18} className="text-blue-600 shrink-0 ml-2" />}
                    </button>
                  </div>

                  {/* 自定义输入框 */}
                  {customInputModes[q.id] && (
                    <div className="pl-0 md:pl-12 animate-in fade-in slide-in-from-top-2">
                      <textarea
                        className="w-full p-3 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm bg-blue-50/30"
                        placeholder="请具体描述您的情况..."
                        rows={2}
                        value={answers[q.id] || ''}
                        onChange={(e) => handleCustomInputChange(q.id, e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Quote Proposal */}
        {step === 'quote' && quoteData && (
          <div className="space-y-8 animate-in zoom-in-95 duration-500 max-w-4xl mx-auto">

            {/* 定价公式展示 */}
            <div className="bg-slate-900 text-slate-300 p-6 rounded-2xl shadow-lg border border-slate-800">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Calculator size={14} /> 报价构成逻辑（一次性交付）
              </h3>
              <div className="text-center font-mono text-sm md:text-lg space-y-2 md:space-y-0 md:space-x-2">
                <span className="inline-block text-white font-bold">一口价</span>
                <span className="inline-block">=</span>
                <span className="inline-block px-2 py-1 bg-slate-800 rounded text-blue-300">搭建费</span>
                <span className="inline-block">+</span>
                <span className="inline-block px-2 py-1 bg-slate-800 rounded text-purple-300">节点/复杂度</span>
                <span className="inline-block">+</span>
                <span className="inline-block px-2 py-1 bg-slate-800 rounded text-green-300">调试与交付</span>
              </div>
            </div>

            <div className="bg-green-50 p-6 rounded-2xl border border-green-100 flex gap-4 items-start">
              <div className="bg-green-100 p-2 rounded-full shrink-0 text-green-700 mt-1">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="font-bold text-green-800 mb-1">顾问建议</h3>
                <p className="text-green-700 leading-relaxed text-sm md:text-base">
                  {quoteData.analysis}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {quoteData.tiers.map((tier, index) => {
                const isRecommended = index === 1; // 假定中间是推荐款
                // Z-index bug fix: 推荐卡片保持z-10，但header是z-50，所以不会遮挡header。
                // 另外，给非推荐卡片设置低层级，避免hover时的层级混乱
                return (
                  <div key={index} className={`relative rounded-2xl border-2 transition-all flex flex-col ${isRecommended
                    ? 'bg-white border-blue-500 shadow-xl shadow-blue-500/10 z-10 scale-[1.02]'
                    : 'bg-white border-slate-100 shadow-md grayscale-[0.1] hover:grayscale-0 z-0'
                    }`}>
                    {isRecommended && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-sm">
                        店长推荐
                      </div>
                    )}
                    <div className="p-6 flex-1">
                      <div className="mb-4">
                        <h3 className="font-bold text-slate-900 text-lg">{tier.name}</h3>
                        <p className="text-xs text-slate-500 mt-1 font-medium bg-slate-100 inline-block px-2 py-1 rounded">{tier.desc}</p>
                      </div>
                      <div className="text-3xl font-black text-slate-900 mb-6 tracking-tight">
                        {tier.price === '咨询报价' ? <span className="text-2xl">咨询报价</span> : `¥${tier.price}`}
                      </div>
                      <div className="h-px bg-slate-100 mb-6"></div>
                      <ul className="space-y-3">
                        {tier.features.map((feature, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                            <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" />
                            <span className="leading-snug">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="bg-slate-100 rounded-2xl p-6 space-y-3 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-800 text-sm font-bold uppercase tracking-wide">
                <ShieldCheck size={16} />
                服务保障与须知
              </div>
              <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
                {quoteData.notes.map((note, i) => (
                  <li key={i} className="pl-1">{note}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

      </main>

      {/* Footer Actions - 固定在底部 */}
      <footer className="bg-white border-t border-slate-100 p-4 md:p-6 z-40 sticky bottom-0">
        <div className="max-w-4xl mx-auto w-full">
          {step === 'input' && (
            <button
              onClick={handleAnalyzeRequest}
              disabled={!userRequest.trim()}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-[0.99] text-lg"
            >
              开始评估 <ChevronRight size={20} />
            </button>
          )}

          {step === 'questions' && (
            <button
              onClick={handleGenerateQuote}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-800 flex items-center justify-center gap-2 transition-all active:scale-[0.99] text-lg"
            >
              查看我的定制方案 <Calculator size={20} />
            </button>
          )}

          {step === 'quote' && (
            <div className="flex flex-col md:flex-row gap-4">
              <button
                onClick={restart}
                className="flex-1 bg-slate-100 text-slate-700 font-bold py-4 rounded-xl hover:bg-slate-200 transition-colors"
              >
                重新评估
              </button>
              <button
                onClick={copyToClipboard}
                className="flex-[2] bg-blue-600 text-white font-bold py-4 rounded-xl shadow-blue-500/30 shadow-lg hover:bg-blue-700 flex items-center justify-center gap-2 transition-all active:scale-[0.99] text-lg"
              >
                复制方案联系卖家 <Copy size={20} />
              </button>
            </div>
          )}
        </div>
      </footer>

    </div>
  );
};

export default App;