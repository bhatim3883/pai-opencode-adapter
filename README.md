# 🤖 pai-opencode-adapter - Use Any AI Provider

[![Download pai-opencode-adapter](https://img.shields.io/badge/Download-Release%20Page-blue?style=for-the-badge)](https://github.com/bhatim3883/pai-opencode-adapter/releases)

## 🚀 Overview

pai-opencode-adapter lets you run PAI with OpenCode without an Anthropic subscription. It adds a simple adapter layer so you can connect the app to the LLM provider you want.

Use it if you want to:

- Run PAI with your own AI provider
- Avoid an Anthropic-only setup
- Keep OpenCode in your workflow
- Use local or cloud models with one app path

This project fits users who want a simple setup on Windows and do not want to deal with account limits or provider lock-in.

## 💻 What you need

Before you install, make sure you have:

- A Windows PC
- A stable internet connection
- Enough free disk space for the app and any model files
- Access to an LLM provider such as OpenAI, Gemini, Ollama, or another supported service
- Permission to run downloaded apps on your PC

If you use a local model tool like Ollama, keep that installed and running before you start PAI.

## 📥 Download

Visit this page to download the latest Windows release:

[Download the latest release](https://github.com/bhatim3883/pai-opencode-adapter/releases)

On the release page, look for the Windows file that matches your system. If there are multiple files, pick the one meant for Windows.

## 🪟 Install on Windows

Follow these steps:

1. Open the release page.
2. Download the Windows release file.
3. Open your Downloads folder.
4. Double-click the file you downloaded.
5. If Windows shows a security prompt, choose the option to run the file.
6. Follow the setup steps on screen.
7. Finish the install and keep the app in a folder you can reach again.

If the app comes as a .zip file, right-click it and choose Extract All before you open it.

## ⚙️ Set up your AI provider

pai-opencode-adapter works with different LLM providers. Pick the one you already use.

### OpenAI

Use your OpenAI API key in the app settings or config file if the app asks for one.

### Gemini

Enter your Gemini key if you want to use Google’s models.

### Ollama

If you use Ollama, start Ollama first, then point the adapter to your local host address.

### Other providers

If your provider works with OpenAI-style API settings, you can often use it here too. That includes many hosted and local model servers.

## ▶️ Run the app

After install, start pai-opencode-adapter from the file you downloaded or from the shortcut the app creates.

Then:

1. Open the app.
2. Choose your provider.
3. Add your API key or local server address.
4. Save your settings.
5. Start OpenCode with PAI through the adapter.

If you use a local model, make sure the model server is already running before you open the adapter.

## 🧭 How it works

pai-opencode-adapter sits between OpenCode and your chosen AI provider.

It helps with:

- Request routing
- Provider setup
- Switching between AI backends
- Using PAI without an Anthropic plan

This setup gives you one place to manage your AI connection instead of changing your workflow each time you change providers.

## 🔧 Common setup examples

### OpenAI setup

- Get your API key
- Paste it into the app
- Choose an OpenAI model
- Save and run

### Gemini setup

- Get your Gemini key
- Enter it in the adapter
- Pick a model
- Save and run

### Ollama setup

- Install Ollama
- Pull the model you want
- Start Ollama
- Set the local address in the adapter
- Save and run

## 🧪 If something does not work

Try these checks:

- Make sure the app finished downloading
- Check that Windows did not block the file
- Confirm your API key is correct
- Check that your provider account has access
- Make sure Ollama or another local server is running
- Restart the app after changing settings

If the app still does not connect, test your provider in its own app or web page first.

## 🗂 File handling tips

Keep the app in a folder you can find later. A simple path like Downloads or Desktop works for most users.

If you move the app file after setup, open it from the new location and make sure any saved settings still point to the right provider.

## 🔐 Privacy and control

Because this project lets you use different providers, you can choose the setup that fits your needs. You can use a cloud provider or keep things local with a model server on your own machine.

That gives you more control over:

- Which model you use
- Where your data goes
- How your AI tools connect

## 📚 Useful terms

- **Adapter**: A tool that connects two apps or services
- **LLM**: Large language model, the AI system behind chat tools
- **API key**: A code that lets an app use a service
- **Local model**: An AI model that runs on your own PC
- **Provider**: The service that runs the AI model

## 🧰 Topics covered

This project works across:

- adapter
- ai
- claude
- gemini
- llm
- ollama
- openai
- opencode
- pai
- personal-ai

## 📦 Quick start

1. Go to the release page
2. Download the Windows file
3. Open the file or unzip it
4. Set your AI provider
5. Save your settings
6. Run PAI through OpenCode

[Open the download page](https://github.com/bhatim3883/pai-opencode-adapter/releases)