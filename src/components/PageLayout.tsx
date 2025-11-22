import React from 'react';

interface PageLayoutProps {
  children: React.ReactNode;
  /**
   * Optional header content (title, actions, etc.)
   */
  header?: React.ReactNode;
  /**
   * Whether to show a border at the bottom of the header
   * @default true
   */
  headerBorder?: boolean;
  /**
   * Custom padding for the content area
   * @default 'px-2 py-6'
   */
  contentPadding?: string;
  /**
   * Maximum width constraint for the content
   * @default 'max-w-7xl'
   */
  maxWidth?: string;
}

/**
 * Reusable page layout component that provides consistent spacing
 * and structure across all pages. Removes duplicate layout code.
 */
const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  header,
  headerBorder = true,
  contentPadding = 'px-2 py-6',
  maxWidth = 'max-w-7xl',
}) => {
  return (
    <div className="w-full">
      {/* Optional Header Section */}
      {header && (
        <div className={`bg-card ${headerBorder ? 'border-b' : ''}`}>
          <div className={`${contentPadding} ${maxWidth} mx-auto`}>
            {header}
          </div>
        </div>
      )}

      {/* Main Content Section */}
      <div className={`${contentPadding} ${maxWidth} mx-auto`}>
        {children}
      </div>
    </div>
  );
};

export default PageLayout;

