export interface IssueValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

export function validateIssueMarkdown(content: string): IssueValidationResult;
