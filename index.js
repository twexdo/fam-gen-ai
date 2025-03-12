const { GoogleGenerativeAI } = require("@google/generative-ai");
const readlineSync = require("readline-sync");
const fs = require("fs");
const { Hono } = require("hono");
const { serve } = require("@hono/node-server");
const handler = require("serve-handler");

// Global configuration
const API_KEY = "AIzaSyAmjBZH2UYV4RJvf9G8LflIc8EufRfqR2A";
const MEMORY_FILE_PATH = "data.txt"; // File for memory storage

// Global variables
let genAI = null;

// Global prompt structure
const INITIAL_PROMPT = `
# FamilyBot - Family Assistant System

## Core Identity
You are FamilyBot, an intelligent assistant designed specifically for a multi-user family environment.

## Language Setting
PRIMARY_LANGUAGE: ROMANA (Romanian)
- All responses must be in Romanian unless explicitly requested otherwise

## Multi-User Awareness Protocol
1. CRITICAL: This chat interface is shared among MULTIPLE FAMILY MEMBERS
2. User identification is your HIGHEST priority when session begins
3. If current user is UNKNOWN:
   - Immediately ask: "Bună! Cu cine am plăcerea să vorbesc astăzi?"
   - Do not proceed with substantive assistance until user identity is confirmed

## Data Storage System
- All data is saved to external TXT files
- Each saved entry must have a unique identifier and importance rating
- AI can create multiple SAVE operations in a single response
- Format for saving information:
<SAVE id="[UNIQUE_ID]" importance="[1-1000]" context="[CATEGORY]" date="[CURRENT_DATE]" user="[USERNAME]"[STRUCTURED_INFORMATION]</SAVE>

### Parameters Explained:
- id: Unique numeric identifier (line number in storage file)
- importance: Rating from 1-1000 :
Here this should be refering to importance in time, this importance is for your brain like a neuron opening.
so if an event is for tomororw, its ok its important, but not that important that you can make it 1000 .

treat importance as neuron openings



- context: Category or situation where information was obtained
- date: Current date in YYYY-MM-DD format
- user: Family member who provided this information

### Data Management:
- AI can perform multiple DELETE operations in a single response
- Use <DELETE id="[ID_NUMBER]"></DELETE> tag to remove outdated or redundant information
- AI should automatically handle duplicate detection
- Before saving new information, AI must check if similar data already exists

## Interaction Guidelines
- Maintain distinct conversation styles for different family members
- Reference only information appropriate to the current user
- Respect privacy boundaries between family members
- Adapt tone and complexity based on identified user


!!!!!RULES!!!!!!:
Before answering, read 3 times this requirements.
Before answering, watch the history 10 times.
YOUR THOUGHTS CAN ALSO BE SENT TROUGH SAVE AND SHOULD BE
ESTI ROMAN, ESTI PSIHOLOG CERTIFICAT AI EXPERIENTA CU ZECI DE CAZURI

Mai jos o sa ai mereu datele salvate in formatul <SAVE></SAVE>
toate aceste informatii trebuie luate in considerare cand formulezi un raspuns.

asa ca daca vreodata vezi informatii irelevante poti sa te folosesti singur de acel tag <DELETE>
 Îmi cer scuze, am folosit incorect tag-ul  <DELETE > .  Am înțeles greșit formatul.  Trebuie să includ ID-ul unic, nu întreaga intrare.  Voi încerca din nou.  Îmi pare rău pentru 
confuzie.

`;

// Load existing data from file
function loadSavedData() {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      const data = fs.readFileSync(MEMORY_FILE_PATH, "utf8");
      return INITIAL_PROMPT + data.trim();
    }
  } catch (error) {
    console.error("Error loading saved data:", error);
  }
  return "";
}

// Initialize the Google AI client
function initializeAI() {
  genAI = new GoogleGenerativeAI(API_KEY);
}
// Save new information to memory file
function saveData(entryText) {
  try {
    fs.appendFileSync(MEMORY_FILE_PATH, entryText + "\n", "utf8");
    console.log("Saved to memory: " + entryText);
  } catch (error) {
    console.error("Error saving data:", error);
  }
}

// Delete information from memory file by ID
function deleteData(id) {
  try {
    // Read the current content
    const content = fs.readFileSync(MEMORY_FILE_PATH, "utf8").split("\n");

    // Find and remove entries with matching ID
    const newContent = content.filter((line) => {
      // Skip empty lines
      if (!line.trim()) return true;

      // Check if this line has the ID we want to delete
      const idMatch = line.match(/id="(\d+)"/);
      return !idMatch || idMatch[1] !== id;
    });

    // Write back the filtered content
    fs.writeFileSync(MEMORY_FILE_PATH, newContent.join("\n"), "utf8");
    console.log("Deleted entry with ID: " + id);
  } catch (error) {
    console.error("Error deleting data:", error);
  }
}

function processTags(responseText) {
  let cleanResponse = responseText;

  // Process SAVE tags - new format
  const saveRegex =
    /<SAVE\s+id="([^"]+)"\s+importance="([^"]+)"\s+context="([^"]+)"\s+date="([^"]+)"\s+user="([^"]+)"\s*>([\s\S]*?)<\/SAVE>/g;
  let saveMatch;

  while ((saveMatch = saveRegex.exec(responseText)) !== null) {
    const id = saveMatch[1];
    const importance = saveMatch[2];
    const context = saveMatch[3];
    const date = saveMatch[4];
    const user = saveMatch[5];
    const info = saveMatch[6].trim();
    const entryText = `<SAVE id="${id}" importance="${importance}" context="${context}" date="${date}" user="${user}">${info}</SAVE>`;
    saveData(entryText);

    // Remove the save tag from the response
    cleanResponse = cleanResponse.replace(saveMatch[0], "");
  }

  // Process DELETE tags
  const deleteRegex = /<DELETE\s+id="([^"]+)"\s*><\/DELETE>/g;
  let deleteMatch;

  while ((deleteMatch = deleteRegex.exec(responseText)) !== null) {
    const id = deleteMatch[1];
    deleteData(id);

    // Remove the delete tag from the response
    cleanResponse = cleanResponse.replace(deleteMatch[0], "");
  }

  // Process legacy SAVE tags for backward compatibility
  const legacySaveRegex = /<SAVE>\[(.*?), (.*?), (.*?)\]: (.*?)<\/SAVE>/g;
  let legacyMatch;

  while ((legacyMatch = legacySaveRegex.exec(responseText)) !== null) {
    const context = legacyMatch[1];
    const date = legacyMatch[2];
    const fromWhom = legacyMatch[3];
    const info = legacyMatch[4];

    const entryText = `[${context}, ${date}, ${fromWhom}]: ${info}`;
    saveData(entryText);

    // Remove the legacy save tag from the response
    cleanResponse = cleanResponse.replace(legacyMatch[0], "");
  }

  return { cleanResponse: cleanResponse.trim() };
}

// Communicate with Gemini API
async function chatWithGemini(userMessage, history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Add user message to conversation context
    const fullContext = history + "\n\nUser: " + userMessage;

    // Generate content with full context
    const result = await model.generateContent(fullContext);
    const responseText = result.response.text();

    // Process save tags and get clean response
    const { cleanResponse } = processTags(responseText);

    // Update history with this exchange
    const updatedHistory = fullContext + "\n\nAssistant: " + cleanResponse;

    return {
      cleanResponse,
      updatedHistory,
    };
  } catch (error) {
    return {
      cleanResponse: `Error: ${error.message}`,
      updatedHistory: history,
    };
  }
}

// ===== Implementare Hono =====

initializeAI(); // Inițializează AI-ul
let conversationHistory = loadSavedData();

const app = new Hono();

// Servește fișiere statice (dacă dorești să ai fișiere separate CSS/JS)
app.use("/static/*", async (c, next) => {
  return handler(c.req.raw, c.res, {
    public: "public",
  });
});

// Endpoint pentru pagina HTML de chat
app.get("/", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ro">
      <head>
        <meta charset="UTF-8" />
        <title>FamilyBot Chat</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          #chat { border: 1px solid #ccc; padding: 10px; height: 400px; overflow-y: scroll; }
          #message { width: 80%; padding: 10px; }
          #send { padding: 10px 20px; }
        </style>
      </head>
      <body>
        <h1>FamilyBot - Asistent Familial</h1>
        <div id="chat">
          <p><strong>Assistant:</strong> Bună! Cu cine am plăcerea să vorbesc astăzi?</p>
        </div>
        <br>
        <input type="text" id="message" placeholder="Scrie un mesaj..." />
        <button id="send">Trimite</button>
        <button id="reset">Schimba Persoana</button>
        <script>
          const chatDiv = document.getElementById('chat');
          const messageInput = document.getElementById('message');
          const sendButton = document.getElementById('send');
          const resetButton = document.getElementById('reset');

          resetButton.addEventListener('click', async()=>{
               chatDiv.innerHTML='<p><strong>Assistant:</strong> Bună! Cu cine am plăcerea să vorbesc astăzi?</p>'
          });

          sendButton.addEventListener('click', async () => {
            const userMessage = messageInput.value.trim();
            if (!userMessage) return;
            // Afișează mesajul utilizatorului
            chatDiv.innerHTML += '<p><strong>Tu:</strong> ' + userMessage + '</p>';
            messageInput.value = '';
            // Trimite mesajul către server
            const response = await fetch('/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: userMessage })
            });
            const data = await response.json();
            // Afișează răspunsul de la FamilyBot
            chatDiv.innerHTML += '<p><strong>Assistant:</strong> ' + data.response + '</p>';
            chatDiv.scrollTop = chatDiv.scrollHeight;
          });

          // Permite și trimiterea mesajelor prin Enter
          messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              sendButton.click();
            }
          });
        </script>
      </body>
    </html>
  `);
});

// Endpoint pentru prelucrarea mesajelor de chat
app.post("/chat", async (c) => {
  const { message } = await c.req.json();
  // Apelează funcția chatWithGemini cu istoricul conversației
  const { cleanResponse, updatedHistory } = await chatWithGemini(
    message,
    conversationHistory
  );
  conversationHistory = updatedHistory;
  return c.json({ response: cleanResponse });
});

app.post("/reset", async (c) => {
  conversationHistory = loadSavedData();
  return c.json({ response: cleanResponse });
});

// Pornește serverul pe portul 3000
serve(app, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
