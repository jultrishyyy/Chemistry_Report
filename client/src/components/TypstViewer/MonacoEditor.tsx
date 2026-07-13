import Editor from '@monaco-editor/react';

interface MonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  height: string;
  readOnly?: boolean;
}

export default function MonacoTypstEditor({ value, onChange, height, readOnly = false }: MonacoEditorProps) {
  return (
    <Editor
      height={height}
      language="plaintext"
      value={value}
      onChange={(v) => onChange?.(v || '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      }}
      theme="vs-dark"
    />
  );
}
