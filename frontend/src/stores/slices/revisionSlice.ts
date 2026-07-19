import type { ChatState, ChatAction } from "../chatStore";

// Revision 切片：文件库 / 回收站刷新计数器（INCREMENT_FILE_RESTORE_REVISIONS 同时递增两者），其它 action 原样返回。
export function revisionReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "INCREMENT_FILE_LIBRARY_REVISION":
      return { ...state, fileLibraryRevision: state.fileLibraryRevision + 1 };
    case "INCREMENT_FILE_RESTORE_REVISIONS":
      return {
        ...state,
        fileLibraryRevision: state.fileLibraryRevision + 1,
        trashRevision: state.trashRevision + 1,
      };
    case "INCREMENT_TRASH_REVISION":
      return { ...state, trashRevision: state.trashRevision + 1 };
    default:
      return state;
  }
}
