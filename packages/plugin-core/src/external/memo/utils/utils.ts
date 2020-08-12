import { DendronWorkspace } from "../../../workspace";
import _ from "lodash";
import { sort as sortPaths } from "cross-path-sort";
import { WorkspaceCache, RefT } from "../types";
import vscode, { workspace, Uri } from "vscode";
import fs from "fs-extra";
import path from "path";
export { sortPaths };

const workspaceCache: WorkspaceCache = {
  imageUris: [],
  markdownUris: [],
  otherUris: [],
  allUris: [],
  danglingRefsByFsPath: {},
  danglingRefs: [],
};

const markdownExtRegex = /\.md$/i;

export const containsMarkdownExt = (pathParam: string): boolean =>
  !!markdownExtRegex.exec(path.parse(pathParam).ext);

export const refPattern = "(\\[\\[)([^\\[\\]]+?)(\\]\\])";

// export const isInFencedCodeBlock = (
//   documentOrContent: TextDocument | string,
//   lineNum: number,
// ): boolean => {
//   const content =
//     typeof documentOrContent === 'string' ? documentOrContent : documentOrContent.getText();
//   const textBefore = content
//     .slice(0, positionToOffset(content, { line: lineNum, column: 0 }))
//     .replace(REGEX_FENCED_CODE_BLOCK, '')
//     .replace(/<!--[\W\w]+?-->/g, '');
//   // So far `textBefore` should contain no valid fenced code block or comment
//   return /^( {0,3}|\t)```[^`\r\n]*$[\w\W]*$/gm.test(textBefore);
// };

// === Utils

export const escapeForRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findUriByRef = (
  uris: vscode.Uri[],
  ref: string
): vscode.Uri | undefined => {
  return uris.find((uri) => {
    // const relativeFsPath =
    //   path.sep + path.relative(getWorkspaceFolder()!.toLowerCase(), uri.fsPath.toLowerCase());

    // if (containsImageExt(ref) || containsOtherKnownExts(ref) || containsUnknownExt(ref)) {
    //   if (isLongRef(ref)) {
    //     return normalizeSlashes(relativeFsPath).endsWith(ref.toLowerCase());
    //   }

    //   const basenameLowerCased = path.basename(uri.fsPath).toLowerCase();

    //   return (
    //     basenameLowerCased === ref.toLowerCase() || basenameLowerCased === `${ref.toLowerCase()}.md`
    //   );
    // }

    // if (isLongRef(ref)) {
    //   return normalizeSlashes(relativeFsPath).endsWith(`${ref.toLowerCase()}.md`);
    // }

    const name = path.parse(uri.fsPath).name.toLowerCase();

    return (
      containsMarkdownExt(path.basename(uri.fsPath)) &&
      name === ref.toLowerCase()
    );
  });
};

export const getFileUrlForMarkdownPreview = (filePath: string): string =>
  vscode.Uri.file(filePath).toString().replace("file://", "");

export const trimLeadingSlash = (value: string) =>
  value.replace(/^\/+|^\\+/g, "");
export const normalizeSlashes = (value: string) => value.replace(/\\/gi, "/");

export const fsPathToRef = ({
  path: fsPath,
  keepExt,
  basePath,
}: {
  path: string;
  keepExt?: boolean;
  basePath?: string;
}): string | null => {
  const ref =
    basePath && fsPath.startsWith(basePath)
      ? normalizeSlashes(fsPath.replace(basePath, ""))
      : path.basename(fsPath);

  if (keepExt) {
    return trimLeadingSlash(ref);
  }

  return trimLeadingSlash(
    ref.includes(".") ? ref.slice(0, ref.lastIndexOf(".")) : ref
  );
};

export const getWorkspaceFolder = (): string | undefined =>
  DendronWorkspace.instance().rootWorkspace.uri.fsPath;

export const parseRef = (rawRef: string): RefT => {
  const dividerPosition = rawRef.indexOf("|");
  if (dividerPosition < 0) {
    return {
      ref: _.trim(rawRef),
      label: _.trim(rawRef),
    };
  } else {
    return {
      ref: _.trim(rawRef.slice(dividerPosition + 1, rawRef.length)),
      label: _.trim(rawRef.slice(0, dividerPosition)),
    };
  }
};

// === Cache
export const cacheWorkspace = async () => {
  await cacheUris();
  await cacheRefs();
};

export const cacheUris = async () => {
  const root = DendronWorkspace.instance().rootWorkspace;
  const markdownUris = _.values(DendronWorkspace.instance().engine.notes)
    .filter((n) => !n.stub)
    .map((n) => {
      return Uri.joinPath(root.uri, n.fname + ".md");
    });
  workspaceCache.markdownUris = sortPaths(markdownUris, {
    pathKey: "path",
    shallowFirst: true,
  });
  workspaceCache.allUris = sortPaths([...markdownUris], {
    pathKey: "path",
    shallowFirst: true,
  });
};

export const cacheRefs = async () => {
  workspaceCache.danglingRefsByFsPath = await findDanglingRefsByFsPath(
    workspaceCache.markdownUris
  );
  workspaceCache.danglingRefs = sortPaths(
    Array.from(
      new Set(
        Object.values(workspaceCache.danglingRefsByFsPath).flatMap(
          (refs) => refs
        )
      )
    ),
    { shallowFirst: true }
  );
};

export const findDanglingRefsByFsPath = async (uris: vscode.Uri[]) => {
  const refsByFsPath: { [key: string]: string[] } = {};

  for (const { fsPath } of uris) {
    const fsPathExists = fs.existsSync(fsPath);
    if (
      !fsPathExists ||
      !containsMarkdownExt(fsPath) ||
      (fsPathExists && fs.lstatSync(fsPath).isDirectory())
    ) {
      continue;
    }

    const doc = workspace.textDocuments.find(
      (doc) => doc.uri.fsPath === fsPath
    );
    const refs = extractDanglingRefs(
      doc ? doc.getText() : fs.readFileSync(fsPath).toString()
    );

    if (refs.length) {
      refsByFsPath[fsPath] = refs;
    }
  }

  return refsByFsPath;
};

const refRegexp = new RegExp(refPattern, "gi");

export const extractDanglingRefs = (content: string) => {
  const refs: string[] = [];

  content.split(/\r?\n/g).forEach((lineText, _lineNum) => {
    for (const match of matchAll(refRegexp, lineText)) {
      const [, , reference] = match;
      if (reference) {
        // const offset = (match.index || 0) + 2;

        // if (isInFencedCodeBlock(content, lineNum) || isInCodeSpan(content, lineNum, offset)) {
        //   continue;
        // }

        const { ref } = parseRef(reference);

        if (!findUriByRef(getWorkspaceCache().allUris, ref)) {
          refs.push(ref);
        }
      }
    }
  });

  return Array.from(new Set(refs));
};

export const getWorkspaceCache = (): WorkspaceCache => workspaceCache;

export const matchAll = (
  pattern: RegExp,
  text: string
): Array<RegExpMatchArray> => {
  let match: RegExpMatchArray | null;
  const out: RegExpMatchArray[] = [];

  pattern.lastIndex = 0;

  while ((match = pattern.exec(text))) {
    out.push(match);
  }

  return out;
};

export const replaceRefs = ({
  refs,
  content,
  onMatch,
  onReplace,
}: {
  refs: { old: string; new: string }[];
  content: string;
  onMatch?: () => void;
  onReplace?: () => void;
}): string | null => {
  const { updatedOnce, nextContent } = refs.reduce(
    ({ updatedOnce, nextContent }, ref) => {
      //const pattern = `\\[\\[${escapeForRegExp(ref.old)}(\\|.*)?\\]\\]`;
      const oldRef = escapeForRegExp(ref.old);
      const pattern = `\\[\\[\\s*?(.*\\|)?\\s*${oldRef}\\s*\\]\\]`;

      if (new RegExp(pattern, "i").exec(content)) {
        let replacedOnce = false;

        // @ts-ignore
        const nextContent = content.replace(
          new RegExp(pattern, "gi"),
          ($0, $1, offset) => {
            // const pos = document.positionAt(offset);

            // if (
            //   isInFencedCodeBlock(document, pos.line) ||
            //   isInCodeSpan(document, pos.line, pos.character)
            // ) {
            //   return $0;
            // }

            if (!replacedOnce) {
              onMatch && onMatch();
            }

            onReplace && onReplace();

            replacedOnce = true;

            return `[[${_.trim($1) || ""}${ref.new}]]`;
          }
        );

        return {
          updatedOnce: true,
          nextContent,
        };
      }

      return {
        updatedOnce: updatedOnce,
        nextContent: nextContent,
      };
    },
    { updatedOnce: false, nextContent: content }
  );

  return updatedOnce ? nextContent : null;
};