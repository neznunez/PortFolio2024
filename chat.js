async function sendMessage(message) {
    try {
        const response = await fetch("http://localhost:3000/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            throw new Error(`Erro no backend: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        return data.generated_text || "Não consegui entender sua mensagem.";
    } catch (error) {
        console.error("Erro ao acessar o backend:", error);
        return "Erro ao processar a requisição.";
    }
}

document.getElementById("enviar").addEventListener("click", async () => {
    const userInput = document.getElementById("chat-input").value;
    const response = await sendMessage(userInput);

    const messages = document.getElementById("chat-messages");
    messages.innerHTML += `<div>Você: ${userInput}</div>`;
    messages.innerHTML += `<div>Bot: ${response}</div>`;
}); 