import { Fragment, type ReactNode } from 'react';
import { readReportRichDocument, reportParagraphCSS, type ReportRichNode } from '../../../../shared/report-rich-document';
export default function ReportRichText({ value }: { value: string }) {
  const render = (node: ReportRichNode, index: number): ReactNode => {
    const children = node.content?.map(render);
    if (node.type === 'text') {
      let text: ReactNode = node.text;
      for (const mark of node.marks || []) text = mark.type === 'reportTextStyle'
        ? <span style={{ fontFamily: mark.attrs?.font ? `${JSON.stringify(mark.attrs.font)},Arial` : undefined, fontSize: mark.attrs?.fontSize ? `${mark.attrs.fontSize}pt` : undefined, color: mark.attrs?.color }}>{text}</span>
        : mark.type === 'bold' ? <strong>{text}</strong> : <em>{text}</em>;
      return <Fragment key={index}>{text}</Fragment>;
    }
    if (node.type === 'hardBreak') return <br key={index} />;
    if (node.type === 'reportSpacer') return <div key={index} className="report-text-spacer" data-height={node.attrs?.height} style={{ height: node.attrs?.height }} />;
    if (node.type === 'paragraph') return <p key={index} style={{ whiteSpace: 'pre-wrap', textAlign: node.attrs?.textAlign, ...reportParagraphCSS(node.attrs) }}>{children?.length ? children : <br />}</p>;
    if (node.type === 'bulletList') return <ul key={index}>{children}</ul>;
    if (node.type === 'orderedList') return <ol key={index} start={node.attrs?.start || 1}>{children}</ol>;
    if (node.type === 'listItem') return <li key={index}>{children}</li>;
    return <div key={index} className="report-rich-text">{children}</div>;
  };
  return render(readReportRichDocument(value), 0);
}
