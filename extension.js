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

    process.env['PHPCS_HOST_ARGS'] = this.getArgs(document, false).join(" ");
    process.env['PHPCS_DOCKER_ARGS'] = this.getArgs(document).join(" ");

    const exec = cp.spawn(this.executablePath, this.getArgs(document));
    this.handleProcessOutput(exec);
};

PhpCsFixer.prototype.getArgs = function (document, is_docker=true) {
    let args = ["fix"];
    let configFile = "";
    let documentFile = document.fileName;
    let is_replace = false;
    if(is_docker && this.dockerPath) {
        is_replace = true;
    }

    if(is_replace) {
        documentFile = documentFile.replace(this.hostPath, this.dockerPath);
    }
    // console.log("file: " + document.fileName + " => " + documentFile);

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
        if(is_replace) {
            configFile = configFile.replace("--config=" + this.hostPath, "--config=" + this.dockerPath);
        }

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

    this.executablePath = this.executablePath.replace(/^~\//, os.homedir() + "/");

    if (!path.isAbsolute(this.executablePath)) {
        this.executablePath = path.join(vscode.workspace.workspaceFolders[0].uri.path, this.executablePath);
    }

    if (/\s/.test(this.executablePath)) {
        vscode.window.showErrorMessage(`Docker PHP CS Fixer: Installing PHP CS Fixer binary into a directory whose path contains spaces is not supported.`);
    }

    this.useConfigFile = config.get("useConfig");
    this.configFile = config.get("config");
    this.runOnSave = config.get("save");
    this.usingCache = config.get("usingCache");
    this.rules = config.get("rules");
    this.hostPath = config.get("hostPath").replace(/^~\//, os.homedir() + "/");

    // console.log('this.hostPath: '+this.hostPath);
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
                    vscode.window.showErrorMessage("Docker PHP CS Fixer: Document formatting is not supported. Run on save.");

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
