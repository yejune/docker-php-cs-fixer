const vscode = require("vscode");
// const { commands, workspace, window, languages, Range, Position } = vscode;
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let willFixOnSave = undefined;

function PhpCsFixer() {
    //
}

PhpCsFixer.prototype.fix = function (document) {
    if (document.languageId !== "php") {
        return;
    }
    const exec = cp.spawn(this.executablePath, this.getArgs(document));
    this.handleProcessOutput(exec);
};

PhpCsFixer.prototype.getArgs = function (document) {
    let args = ["fix"];
    let configFile = "";
    let documentFile = document.fileName;

    if (this.dockerPath) {
        documentFile = this.dockerPath ? documentFile.replace(this.hostPath, this.dockerPath) : documentFile;
        // console.log("file: " + document.fileName + " => " + documentFile);
    }

    args.push(documentFile);

    if (this.useConfigFile) {
        const configFilePath = path.join(vscode.workspace.workspaceFolders[0].uri.path, this.configFile);
        const fallbackConfigPath = path.resolve(__dirname, ".php_cs.dist");

        if (fs.existsSync(configFilePath)) {
            configFile = "--config=" + configFilePath;
        } else if (fs.existsSync(fallbackConfigPath)) {
            configFile = "--config=" + fallbackConfigPath;
        } else {
            vscode.window.showErrorMessage(`Docker PHP CS Fixer: Can't find config file: [${this.configFile}]`);
        }
    }

    if (configFile && configFile.length) {
        configFile = this.dockerPath
            ? configFile.replace("--config=" + this.hostPath, "--config=" + this.dockerPath)
            : configFile;

        args.push(configFile);
    }

    if (!this.usingCache) {
        args.push("--using-cache=no");
    }

    if (this.rules) {
        args.push("--rules=" + this.rules);
    }

    return args;
};

PhpCsFixer.prototype.handleProcessOutput = function (exec) {
    let errors = [];
    let outputs = [];

    exec.stderr.on("data", (buffer) => {
        //console.log(buffer.toString());
        errors.push(buffer.toString());
    });
    exec.stdout.on("data", (buffer) => {
        //console.log(buffer.toString());
        outputs.push(buffer.toString());
    });
    exec.on("close", (code) => {
        let codeHandlers = {
            0: () => {
                vscode.window.setStatusBarMessage("Docker PHP CS Fixer: Fixed all files!", 2500);
            },
            16: () => {
                vscode.window.showErrorMessage("Docker PHP CS Fixer: Config error.");
            },
            32: () => {
                vscode.window.showErrorMessage("Docker PHP CS Fixer: Fixer error.");
            },
            fallback: () => {
                vscode.window.showErrorMessage("Docker PHP CS Fixer: Unknown error.");
            },
        };

        codeHandlers[code in codeHandlers ? code : "fallback"]();
        if (errors.length) {
            console.log("[ERROR]\n" + errors.join("\n"));
        }
        if (outputs.length) {
            console.log("[OUTPUT]\n" + outputs.join("\n"));
        }
    });
};

PhpCsFixer.prototype.loadConfig = function () {
    const config = vscode.workspace.getConfiguration("docker-php-cs-fixer");

    this.executablePath = config.get("executablePath");

    if (
        os.platform() == "win32" &&
        config.has("executablePathWindows") &&
        config.get("executablePathWindows").length > 0
    ) {
        this.executablePath = config.get("executablePathWindows");
    }

    this.useConfigFile = config.get("useConfig");
    this.configFile = config.get("config");
    this.runOnSave = config.get("save");
    this.usingCache = config.get("usingCache");
    this.rules = config.get("rules");
    this.hostPath = config.get("hostPath").replace(/^~\//, os.homedir() + "/");
    this.dockerPath = config.get("dockerPath");
    this.documentFormattingProvider = config.get("documentFormattingProvider", true);

    if (this.runOnSave && !willFixOnSave) {
        willFixOnSave = vscode.workspace.onDidSaveTextDocument((document) => {
            this.fix(document);
        });
    } else if (!this.runOnSave && willFixOnSave) {
        willFixOnSave.dispose();
        willFixOnSave = undefined;
    }
};

function activate(context) {
    const phpCsFixer = new PhpCsFixer();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(() => {
            phpCsFixer.loadConfig();
        })
    );

    phpCsFixer.loadConfig();

    vscode.commands.registerTextEditorCommand;

    vscode.commands.registerTextEditorCommand("docker-php-cs-fixer.fix", (textEditor) => {
        phpCsFixer.fix(textEditor.document);
    });

    if (phpCsFixer.documentFormattingProvider) {
        context.subscriptions.push(
            vscode.languages.registerDocumentFormattingEditProvider("php", {
                provideDocumentFormattingEdits: (document, options, token) => {
                    console.log("[STOP] document formatting\n" + document.uri.toString());

                    return;
                },
            })
        );
    }
}
exports.activate = activate;

function deactivate() {
    if (willFixOnSave) {
        willFixOnSave.dispose();
        willFixOnSave = undefined;
    }
}
exports.deactivate = deactivate;
