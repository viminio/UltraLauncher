<p align="center"><img src="./app/assets/images/SealCircle.png" width="150px" height="150px" alt="aventium softworks"></p>

<h1 align="center">Ultra Launcher</h1>

<em><h5 align="center">(Anteriormente Electron Launcher)</h5></em>

[<p align="center"><img src="https://img.shields.io/github/workflow/status/viminio/UltraLauncher/Build.svg?style=for-the-badge" alt="gh actions">](https://github.com/viminio/UltraLauncher/actions) [<img src="https://img.shields.io/github/downloads/viminio/UltraLauncher/total.svg?style=for-the-badge" alt="downloads">](https://github.com/viminio/UltraLauncher/releases)</p>

<p align="center">Junte-se aos servidores CraftGX sem se preocupar em instalar Java, Forge ou outros mods. Nós tratamos disso para você.</p>

![Screenshot 1](https://i.imgur.com/6o7SmH6.png)
![Screenshot 2](https://i.imgur.com/x3B34n1.png)

## Características

* 🔒 **Gerenciamento completo de contas.**
  * Adicione várias contas e alterne facilmente entre elas.
  * Autenticação Microsoft (OAuth 2.0) + Mojang (Yggdrasil) totalmente compatível.
  * Suporte completo ao minecraft pirata (non-premium)
  * As credenciais nunca são armazenadas e transmitidas diretamente para a Mojang.
* 📂 **Gestão eficiente de arquivos.**
  * Receba atualizações do cliente assim que as liberarmos.
  * Os arquivos são validados antes de abrir. Arquivos corrompidos ou incorretos serão baixados novamente.
* ☕ **Validação automática de Java.**
  * Se você tiver uma versão incompatível do Java instalada, instalaremos a certa *para você*.
  * Você não precisa ter o Java instalado para executar o inicializador.
* 📰 **Feed de notícias integrado nativamente ao iniciador.**
* ⚙️ **Gerenciamento de configurações intuitivo, incluindo um painel de controle Java.**
* Suporta todos os nossos servidores.
  * Alterne entre as configurações do servidor com facilidade.
  * Veja a contagem de jogadores do servidor selecionado.
* Atualizações automáticas. Isso mesmo, o launcher se atualiza sozinho.
* Veja o status dos serviços da Mojang.

Isto não é uma lista exaustiva. Baixe e instale o launcher para avaliar tudo o que ele pode fazer!

#### Precisa de ajuda? [Verifique a wiki.][wiki]

#### Gostou do projeto? Deixe uma estrela ⭐ no repositório!

## Downloads

Você pode baixar de [GitHub Releases](https://github.com/viminio/UltraLauncher/releases)

#### Último lançamento

[![](https://img.shields.io/github/release/viminio/UltraLauncher.svg?style=flat-square)](https://github.com/viminio/UltraLauncher/releases/latest)

#### Latest Pre-Release
[![](https://img.shields.io/github/release/viminio/UltraLauncher/all.svg?style=flat-square)](https://github.com/viminio/UltraLauncher/releases)

**Plataformas compatíveis**

Se você baixar da pagina [Releases](https://github.com/viminio/UltraLauncher/releases), selecione o instalador para o seu sistema.

| Plataforma | Arquivo |
| -------- | ---- |
| Windows x64 | `Ultra-Launcher-setup-VERSION.exe` |
| macOS x64 | `Ultra-Launcher-setup-VERSION-x64.dmg` |
| macOS arm64 | `Ultra-Launcher-setup-VERSION-arm64.dmg` |
| Linux x64 | `Ultra-Launcher-setup-VERSION.AppImage` |

## Console

Para abrir o console, use o seguinte atalho de teclado.

```console
ctrl + shift + i
```

Certifique-se de ter a guia do console selecionada. Não cole nada no console a menos que tenha 100% de certeza do que ele fará. Colar a coisa errada pode expor informações confidenciais.

#### Export Output to a File

Se você quiser exportar o output do console, basta clicar com o botão direito do mouse em qualquer lugar do console e clicar em **Salvar como..**

![Exemplo de console](https://i.imgur.com/T5e73jP.png)


## Desenvolvimento

Esta seção detalha a configuração de um ambiente de desenvolvimento básico.

### Começando

**Requisitos de sistema**

* [Node.js][nodejs] v16

---

**Clonar e instalar dependências**

```console
> git clone https://github.com/viminio/UltraLauncher.git
> cd UltraLauncher
> npm install
```

---

**Iniciar aplicativo**

```console
> npm start
```

---

**Instaladores de compilação**

Para construir para sua plataforma atual.

```console
> npm run dist
```

Crie para uma plataforma específica.

| Platform    | Command              |
| ----------- | -------------------- |
| Windows x64 | `npm run dist:win`   |
| macOS       | `npm run dist:mac`   |
| Linux x64   | `npm run dist:linux` |

As compilações para macOS podem não funcionar no Windows/Linux e vice-versa.

---

### Visual Studio Code

Todo o desenvolvimento do lançador deve ser feito usando [Visual Studio Code][vscode].

Cole o seguinte em `.vscode/launch.json`

```JSON
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "program": "${workspaceFolder}/node_modules/electron/cli.js",
      "args" : ["."],
      "outputCapture": "std"
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "runtimeArgs": [
        "${workspaceFolder}/.",
        "--remote-debugging-port=9222"
      ],
      "webRoot": "${workspaceFolder}"
    }
  ]
}
```

Isso adiciona duas configurações de debug.

#### Debug Processo Principal

Isso permite que você debug o Electron's [main process][mainprocess]. You can debug scripts in the [renderer process][rendererprocess] by opening the DevTools Window.

#### Debug Renderer Process

Isso permite que você debug o Electron's [renderer process][rendererprocess]. This requires you to install the [Debugger for Chrome][chromedebugger] extension.

Observe que você **não pode** abrir a janela DevTools enquanto estiver usando esta configuração de depuração. O Chromium permite apenas um depurador, abrir outro travará o programa.

---

### Nota sobre o uso de terceiros

Por favor, dê crédito ao autor original e forneça um link para a fonte original. Este é um software livre, por favor, faça pelo menos isso.

Para obter instruções sobre como configurar a autenticação da Microsoft, consulte https://github.com/viminio/UltraLauncher/blob/master/docs/MicrosoftAuth.md.

---

## Resources

* [Wiki][wiki]
* [Nebula][nebula]

A melhor maneira de entrar em contato com os desenvolvedores é no Discord.

[![discord](https://discordapp.com/api/guilds/211524927831015424/embed.png?style=banner3)][discord]

---

### Vejo você no jogo.


[nodejs]: https://nodejs.org/en/ 'Node.js'
[vscode]: https://code.visualstudio.com/ 'Visual Studio Code'
[mainprocess]: https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes 'Main Process'
[rendererprocess]: https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes 'Renderer Process'
[chromedebugger]: https://marketplace.visualstudio.com/items?itemName=msjsdiag.debugger-for-chrome 'Debugger for Chrome'
[discord]: https://discord.gg/zNWUXdt 'Discord'
[wiki]: https://github.com/viminio/UltraLauncher/wiki 'wiki'
[nebula]: https://github.com/viminio/Nebula 'viminio/Nebula'
[v2branch]: https://github.com/viminio/UltraLauncher/tree/ts-refactor 'v2 branch'
