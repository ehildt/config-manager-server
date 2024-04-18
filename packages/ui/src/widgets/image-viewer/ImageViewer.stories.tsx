import type { Meta, StoryObj } from '@storybook/react';

import { Container } from '@/layouts/container/Container';
import { ImageViewer } from './ImageViewer';
import { base64, mimeType } from './base64.jpg';

export default {
  title: 'widgets/image-viewer',
  component: ImageViewer,
} satisfies Meta<typeof ImageViewer>;

export const Default = {
  render: () => (
    <Container outerStyle={{ width: '40dvh' }} highlight>
      <ImageViewer mimeType={mimeType} base64={base64} />
    </Container>
  ),
} satisfies StoryObj<typeof ImageViewer>;
