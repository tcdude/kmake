"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinuxExporter = void 0;
const Exporter_1 = require("kmake/Exporters/Exporter");
const Options_1 = require("kmake/Options");
const Platform_1 = require("kmake/Platform");
const Compiler_1 = require("kmake/Compiler");
const fs = require("kmake/fsextra");
const path = require("path");
class LinuxExporter extends Exporter_1.Exporter {
    constructor() {
        super();
    }
    async exportSolution(project, from, to, platform, vrApi, options) {
        this.exportNinjaFile(project, from, to, platform, vrApi, options);
        this.exportMakefile(project, from, to, platform, vrApi, options);
        this.exportCodeBlocks(project, from, to, platform, vrApi, options);
        this.exportCLion(project, from, to, platform, vrApi, options);
        this.exportCompileCommands(project, from, to, platform, vrApi, options);
    }
    getCCompiler() {
        switch (Options_1.Options.compiler) {
            case Compiler_1.Compiler.Default:
            case Compiler_1.Compiler.GCC:
                return 'gcc';
            case Compiler_1.Compiler.Clang:
                return 'clang';
            case Compiler_1.Compiler.MuslGcc:
                return 'musl-gcc';
            case Compiler_1.Compiler.Custom:
                return Options_1.Options.ccPath;
            default:
                throw 'Unsupported compiler ' + Options_1.Options.compiler;
        }
    }
    getCPPCompiler() {
        switch (Options_1.Options.compiler) {
            case Compiler_1.Compiler.Default:
            case Compiler_1.Compiler.GCC:
                return 'g++';
            case Compiler_1.Compiler.Clang:
                return 'clang++';
            case Compiler_1.Compiler.MuslGcc:
                return 'g++';
            case Compiler_1.Compiler.Custom:
                return Options_1.Options.cxxPath;
            default:
                throw 'Unsupported compiler ' + Options_1.Options.compiler;
        }
    }
    getOS() {
        try {
            const data = fs.readFileSync('/etc/os-release', 'utf8');
            const lines = data.split('\n');
            let name = null;
            for (const line of lines) {
                if (line.trim().startsWith('NAME')) {
                    name = line.split('=')[1];
                    name = name.substring(1, name.length - 1);
                    break;
                }
            }
            if (name) {
                return name;
            }
            else {
                return 'Unknown';
            }
        }
        catch (error) {
            return 'Unknown';
        }
    }
    exportNinjaFile(project, from, to, platform, vrApi, options) {
        const cCompiler = this.getCCompiler();
        const cppCompiler = this.getCPPCompiler();
        const os = this.getOS();
        let objects = {};
        let ofiles = {};
        let outputPath = path.resolve(to, options.buildPath);
        fs.ensureDirSync(outputPath);
        for (let fileobject of project.getFiles()) {
            let file = fileobject.file;
            if (file.endsWith('.cpp') || file.endsWith('.c') || file.endsWith('.cc') || file.endsWith('.s') || file.endsWith('.S')) {
                let name = file.toLowerCase();
                if (name.indexOf('/') >= 0)
                    name = name.substr(name.lastIndexOf('/') + 1);
                name = name.substr(0, name.lastIndexOf('.'));
                if (!objects[name]) {
                    objects[name] = true;
                    ofiles[file] = name;
                }
                else {
                    while (objects[name]) {
                        name = name + '_';
                    }
                    objects[name] = true;
                    ofiles[file] = name;
                }
            }
        }
        let ofilelist = '';
        for (let o in objects) {
            ofilelist += o + '.o ';
        }
        this.writeFile(path.resolve(outputPath, 'build.ninja'));
        this.p('pool link_pool\n  depth = 1\n');
        let incline = '';
        for (let inc of project.getIncludeDirs()) {
            inc = path.relative(outputPath, path.resolve(from, inc));
            incline += '-I' + inc + ' ';
        }
        let libsline = '-static-libgcc -static-libstdc++ -pthread';
        if (Options_1.Options.compiler === Compiler_1.Compiler.MuslGcc || os.includes('Alpine')) {
            libsline += ' -static';
        }
        for (let lib of project.getLibs()) {
            libsline += ' -l' + lib;
        }
        libsline += ' ';
        let defline = '';
        for (const def of project.getDefines()) {
            if (def.config && def.config.toLowerCase() === 'debug' && !options.debug) {
                continue;
            }
            if (def.config && def.config.toLowerCase() === 'release' && options.debug) {
                continue;
            }
            defline += '-D' + def.value.replace(/\"/g, '\\"') + ' ';
        }
        if (!options.debug) {
            defline += '-DNDEBUG ';
        }
        let optimization = '';
        if (!options.debug) {
            optimization = '-O2';
        }
        else
            optimization = '-g';
        let cline = cCompiler + ' ';
        if (project.cStd !== '') {
            cline += '-std=' + project.cStd + ' ';
        }
        if (options.dynlib) {
            cline += '-fPIC ';
        }
        for (let flag of project.cFlags) {
            cline += flag + ' ';
        }
        cline += optimization + ' ';
        cline += incline;
        cline += defline;
        this.p('rule cc\n  deps = gcc\n  depfile = $out.d\n  command = ' + cline + '-MD -MF $out.d -c $in -o $out\n');
        let cppline = cppCompiler + ' ';
        if (project.cppStd !== '') {
            cppline += '-std=' + project.cppStd + ' ';
        }
        if (options.dynlib) {
            cppline += '-fPIC ';
        }
        for (let flag of project.cppFlags) {
            cppline += flag + ' ';
        }
        cppline += optimization + ' ';
        cppline += incline;
        cppline += defline;
        this.p('rule cxx\n  deps = gcc\n  depfile = $out.d\n  command = ' + cppline + '-MD -MF $out.d -c $in -o $out\n');
        if (options.dynlib) {
            this.p('rule link\n  pool = link_pool\n  command = ' + this.getCPPCompiler() + ' -fPIC -shared -o $out ' + optimization + ' $in ' + libsline);
        }
        else if (options.lib) {
            this.p('rule link\n  pool = link_pool\n  command = ar rcs -o $out $in');
        }
        else {
            this.p('rule link\n  pool = link_pool\n  command = ' + this.getCPPCompiler() + ' -o $out ' + optimization + ' $in ' + libsline);
        }
        for (let fileobject of project.getFiles()) {
            let file = fileobject.file;
            if (file.endsWith('.c') || file.endsWith('.cpp') || file.endsWith('.cc') || file.endsWith('.s') || file.endsWith('.S')) {
                this.p();
                let name = ofiles[file];
                let realfile = path.relative(outputPath, path.resolve(from, file));
                let compiler = 'cxx';
                if (file.endsWith('.c')) {
                    compiler = 'cc';
                }
                else if (file.endsWith('.s') || file.endsWith('.S')) {
                    compiler = 'asm';
                }
                this.p('build ' + name + '.o: ' + compiler + ' ' + realfile);
            }
        }
        this.p();
        let executableName = project.getSafeName();
        if (project.getExecutableName()) {
            executableName = project.getExecutableName();
        }
        let outputname = executableName;
        if (options.lib) {
            outputname = executableName + '.a';
        }
        else if (options.dynlib) {
            outputname = executableName + '.so';
        }
        this.p('build ' + outputname + ': link ' + ofilelist);
        this.closeFile();
    }
    exportMakefile(project, from, to, platform, vrApi, options) {
        const cCompiler = this.getCCompiler();
        const cppCompiler = this.getCPPCompiler();
        const os = this.getOS();
        let objects = {};
        let ofiles = {};
        let outputPath = path.resolve(to, options.buildPath);
        fs.ensureDirSync(outputPath);
        for (let fileobject of project.getFiles()) {
            let file = fileobject.file;
            if (file.endsWith('.cpp') || file.endsWith('.c') || file.endsWith('.cc') || file.endsWith('.s') || file.endsWith('.S')) {
                let name = file.toLowerCase();
                if (name.indexOf('/') >= 0)
                    name = name.substr(name.lastIndexOf('/') + 1);
                name = name.substr(0, name.lastIndexOf('.'));
                if (!objects[name]) {
                    objects[name] = true;
                    ofiles[file] = name;
                }
                else {
                    while (objects[name]) {
                        name = name + '_';
                    }
                    objects[name] = true;
                    ofiles[file] = name;
                }
            }
        }
        let gchfilelist = '';
        let precompiledHeaders = [];
        for (let file of project.getFiles()) {
            if (file.options && file.options.pch && precompiledHeaders.indexOf(file.options.pch) < 0) {
                precompiledHeaders.push(file.options.pch);
            }
        }
        for (let file of project.getFiles()) {
            let precompiledHeader = null;
            for (let header of precompiledHeaders) {
                if (file.file.endsWith(header)) {
                    precompiledHeader = header;
                    break;
                }
            }
            if (precompiledHeader !== null) {
                // let realfile = path.relative(outputPath, path.resolve(from, file.file));
                gchfilelist += path.basename(file.file) + '.gch ';
            }
        }
        let ofilelist = '';
        for (let o in objects) {
            ofilelist += o + '.o ';
        }
        this.writeFile(path.resolve(outputPath, 'makefile'));
        let incline = '-I./ '; // local directory to pick up the precompiled header hxcpp.h.gch
        for (let inc of project.getIncludeDirs()) {
            inc = path.relative(outputPath, path.resolve(from, inc));
            incline += '-I' + inc + ' ';
        }
        this.p('INC=' + incline);
        let libsline = '-static-libgcc -static-libstdc++ -pthread';
        if (Options_1.Options.compiler === Compiler_1.Compiler.MuslGcc || os.includes('Alpine')) {
            libsline += ' -static';
        }
        for (let lib of project.getLibs()) {
            libsline += ' -l' + lib;
        }
        this.p('LIB=' + libsline);
        let defline = '';
        for (const def of project.getDefines()) {
            if (def.config && def.config.toLowerCase() === 'debug' && !options.debug) {
                continue;
            }
            if (def.config && def.config.toLowerCase() === 'release' && options.debug) {
                continue;
            }
            defline += '-D' + def.value.replace(/\"/g, '\\"') + ' ';
        }
        if (!options.debug) {
            defline += '-DNDEBUG ';
        }
        this.p('DEF=' + defline);
        this.p();
        let cline = '';
        if (project.cStd !== '') {
            cline = '-std=' + project.cStd + ' ';
        }
        if (options.dynlib) {
            cline += '-fPIC ';
        }
        for (let flag of project.cFlags) {
            cline += flag + ' ';
        }
        this.p('CFLAGS=' + cline);
        let cppline = '';
        if (project.cppStd !== '') {
            cppline = '-std=' + project.cppStd + ' ';
        }
        if (options.dynlib) {
            cppline += '-fPIC ';
        }
        for (let flag of project.cppFlags) {
            cppline += flag + ' ';
        }
        this.p('CPPFLAGS=' + cppline);
        let optimization = '';
        if (!options.debug) {
            optimization = '-O2';
        }
        else
            optimization = '-g';
        let executableName = project.getSafeName();
        if (project.getExecutableName()) {
            executableName = project.getExecutableName();
        }
        if (options.lib) {
            this.p(executableName + '.a: ' + gchfilelist + ofilelist);
        }
        else if (options.dynlib) {
            this.p(executableName + '.so: ' + gchfilelist + ofilelist);
        }
        else {
            this.p(executableName + ': ' + gchfilelist + ofilelist);
        }
        let cpp = '';
        let output = '-o "' + executableName + '"';
        if (options.lib) {
            output = '-o "' + executableName + '.a"';
        }
        else if (options.dynlib) {
            output = '-shared -o "' + executableName + '.so"';
        }
        if (options.lib) {
            this.p('\t' + 'ar rcs ' + output + ' ' + ofilelist);
        }
        else {
            this.p('\t' + cppCompiler + ' ' + output + ' ' + cpp + ' ' + optimization + ' ' + ofilelist + ' $(LIB)');
        }
        for (let file of project.getFiles()) {
            let precompiledHeader = null;
            for (let header of precompiledHeaders) {
                if (file.file.endsWith(header)) {
                    precompiledHeader = header;
                    break;
                }
            }
            if (precompiledHeader !== null) {
                let realfile = path.relative(outputPath, path.resolve(from, file.file));
                this.p('-include ' + path.basename(file.file) + '.d');
                this.p(path.basename(realfile) + '.gch: ' + realfile);
                this.p('\t' + cppCompiler + ' ' + cpp + ' ' + optimization + ' $(INC) $(DEF) -MD -c ' + realfile + ' -o ' + path.basename(file.file) + '.gch');
            }
        }
        for (let fileobject of project.getFiles()) {
            let file = fileobject.file;
            if (file.endsWith('.c') || file.endsWith('.cpp') || file.endsWith('.cc') || file.endsWith('.s') || file.endsWith('.S')) {
                this.p();
                let name = ofiles[file];
                let realfile = path.relative(outputPath, path.resolve(from, file));
                this.p('-include ' + name + '.d');
                this.p(name + '.o: ' + realfile);
                let compiler = cppCompiler;
                let flags = '$(CPPFLAGS)';
                if (file.endsWith('.c')) {
                    compiler = cCompiler;
                    flags = '$(CFLAGS)';
                }
                else if (file.endsWith('.s') || file.endsWith('.S')) {
                    compiler = cCompiler;
                    flags = '';
                }
                this.p('\t' + compiler + ' ' + cpp + ' ' + optimization + ' $(INC) $(DEF) -MD ' + flags + ' -c ' + realfile + ' -o ' + name + '.o');
            }
        }
        // project.getDefines()
        // project.getIncludeDirs()
        this.closeFile();
    }
    exportCodeBlocks(project, from, to, platform, vrApi, options) {
        this.writeFile(path.resolve(to, project.getSafeName() + '.cbp'));
        this.p('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
        this.p('<CodeBlocks_project_file>');
        this.p('<FileVersion major="1" minor="6" />', 1);
        this.p('<Project>', 1);
        this.p('<Option title="' + project.getName() + '" />', 2);
        this.p('<Option pch_mode="2" />', 2);
        this.p('<Option compiler="gcc" />', 2);
        this.p('<Build>', 2);
        this.p('<Target title="Debug">', 3);
        let executableName = project.getSafeName();
        if (project.getExecutableName()) {
            executableName = project.getExecutableName();
        }
        this.p('<Option output="bin/Debug/' + executableName + '" prefix_auto="1" extension_auto="1" />', 4);
        if (project.getDebugDir().length > 0)
            this.p('<Option working_dir="' + path.resolve(from, project.getDebugDir()) + '" />', 4);
        this.p('<Option object_output="obj/Debug/" />', 4);
        this.p('<Option type="1" />', 4);
        this.p('<Option compiler="gcc" />', 4);
        this.p('<Compiler>', 4);
        if (project.cppStd !== '') {
            this.p('<Add option="-std=' + project.cppStd + '" />', 5);
        }
        this.p('<Add option="-g" />', 5);
        for (const def of project.getDefines()) {
            if (def.config && def.config.toLowerCase() !== 'debug') {
                continue;
            }
            this.p('<Add option="-D' + def.value.replace(/\"/g, '\\"') + '" />', 3);
        }
        this.p('</Compiler>', 4);
        this.p('</Target>', 3);
        this.p('<Target title="Release">', 3);
        this.p('<Option output="bin/Release/' + executableName + '" prefix_auto="1" extension_auto="1" />', 4);
        if (project.getDebugDir().length > 0)
            this.p('<Option working_dir="' + path.resolve(from, project.getDebugDir()) + '" />', 4);
        this.p('<Option object_output="obj/Release/" />', 4);
        this.p('<Option type="0" />', 4);
        this.p('<Option compiler="gcc" />', 4);
        this.p('<Compiler>', 4);
        if (project.cppStd !== '') {
            this.p('<Add option="-std=' + project.cppStd + '" />', 5);
        }
        this.p('<Add option="-O2" />', 5);
        for (const def of project.getDefines()) {
            if (def.config && def.config.toLowerCase() !== 'release') {
                continue;
            }
            this.p('<Add option="-D' + def.value.replace(/\"/g, '\\"') + '" />', 3);
        }
        this.p('<Add option="-DNDEBUG" />', 3);
        this.p('</Compiler>', 4);
        this.p('<Linker>', 4);
        this.p('<Add option="-s" />', 5);
        this.p('</Linker>', 4);
        this.p('</Target>', 3);
        this.p('</Build>', 2);
        this.p('<Compiler>', 2);
        if (project.cppStd !== '') {
            this.p('<Add option="-std=' + project.cppStd + '" />', 5);
        }
        this.p('<Add option="-Wall" />', 3);
        for (let inc of project.getIncludeDirs()) {
            this.p('<Add directory="' + path.resolve(from, inc) + '" />', 3);
        }
        this.p('</Compiler>', 2);
        this.p('<Linker>', 2);
        this.p('<Add option="-pthread" />', 3);
        this.p('<Add option="-static-libgcc" />', 3);
        this.p('<Add option="-static-libstdc++" />', 3);
        /*if (project.cmd) {
            this.p('<Add option="-static" />', 3);
        }*/
        this.p('<Add option="-Wl,-rpath,." />', 3);
        const flags = [].concat(project.cFlags, project.cppFlags);
        for (const flag of flags) {
            this.p('<Add option="' + flag.replace(/\"/g, '\\"') + '" />', 3);
        }
        for (let lib of project.getLibs()) {
            this.p('<Add library="' + lib + '" />', 3);
        }
        if (platform === Platform_1.Platform.Pi) {
            this.p('<Add directory="/opt/vc/lib" />', 3);
        }
        this.p('</Linker>', 2);
        let precompiledHeaders = [];
        for (let file of project.getFiles()) {
            if (file.options && file.options.pch && precompiledHeaders.indexOf(file.options.pch) < 0) {
                precompiledHeaders.push(file.options.pch);
            }
        }
        for (let file of project.getFiles()) {
            let precompiledHeader = null;
            for (let header of precompiledHeaders) {
                if (file.file.endsWith(header)) {
                    precompiledHeader = header;
                    break;
                }
            }
            if (file.file.endsWith('.c') || file.file.endsWith('.cc') || file.file.endsWith('.cpp')) {
                this.p('<Unit filename="' + path.resolve(from, file.file) + '">', 2);
                this.p('<Option compilerVar="CC" />', 3);
                this.p('</Unit>', 2);
            }
            else if (file.file.endsWith('.h')) {
                this.p('<Unit filename="' + path.resolve(from, file.file) + '">', 2);
                if (precompiledHeader !== null) {
                    this.p('<Option compile="1" />', 3);
                    this.p('<Option weight="0" />', 3);
                }
                this.p('</Unit>', 2);
            }
        }
        this.p('<Extensions>', 2);
        this.p('<code_completion />', 3);
        this.p('<debugger />', 3);
        this.p('</Extensions>', 2);
        this.p('</Project>', 1);
        this.p('</CodeBlocks_project_file>');
        this.closeFile();
    }
}
exports.LinuxExporter = LinuxExporter;
//# sourceMappingURL=LinuxExporter.js.map